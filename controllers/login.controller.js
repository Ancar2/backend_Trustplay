const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");
const crypto = require("crypto");
const WalletIdentity = require("../models/wallet/walletIdentity.model");
const sendEmail = require("../utils/sendEmail");
const { buildVerificationEmail, buildVerificationCodeEmail } = require("../utils/emailTemplates");
const {
    ensureCurrentLegalAcceptanceForUser,
    ensureNewUserLegalAcceptance,
    registerCurrentLegalAcceptanceForNewUser,
} = require("../services/legal/legal.service");
const {
    normalizeWalletAddress,
    normalizeWalletProvider,
    normalizeWalletType,
    linkLegacyWalletToUser,
    setPrimaryWallet,
} = require("../services/wallets/walletIdentity.service");
const { syncPrivyWalletIdentity } = require("../services/wallets/privy.service");

const WALLET_LOGIN_CHALLENGE_TTL_SECONDS = 10 * 60;
const WALLET_LOGIN_CHALLENGE_PURPOSE = "wallet_login";
const WALLET_REGISTRATION_TEMP_TTL_SECONDS = 20 * 60;
const WALLET_REGISTRATION_TEMP_PURPOSE = "wallet_registration";
const WALLET_EMAIL_CODE_TTL_SECONDS = 30 * 60;
const WALLET_EMAIL_CODE_PURPOSE = "wallet_email_code";
const EMAIL_VERIFY_TTL_MINUTES = Number(process.env.EMAIL_VERIFY_TTL_MINUTES || 60 * 24);

const applyLegalAcceptanceIfRequired = async ({
    user,
    legalAcceptancePayload,
    req,
    source
}) => (
    ensureCurrentLegalAcceptanceForUser({
        userId: user?._id,
        legalAcceptancePayload,
        req,
        source,
    })
);

const buildLegalRequiredErrorPayload = (legalResolution) => {
    const pendingDocuments = Array.isArray(legalResolution?.pendingDocuments)
        ? legalResolution.pendingDocuments
        : [];

    return {
        error: legalResolution?.msg || "Debes aceptar los documentos legales vigentes para continuar.",
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        pendingDocuments,
        legalVersion: pendingDocuments[0]?.version || ""
    };
};

const resolvePendingDocumentsFromLegalResolution = (legalResolution) => (
    Array.isArray(legalResolution?.pendingDocuments) ? legalResolution.pendingDocuments : []
);

const didClientExplicitlyAcceptLegal = (legalAcceptancePayload) => (
    legalAcceptancePayload?.accepted === true
);

const buildLegalStatusPayload = (pendingDocuments = []) => ({
    hasPending: pendingDocuments.length > 0,
    pendingDocuments
});

const buildWalletLoginChallengeMessage = ({
    walletAddress,
    provider,
    walletType,
    nonce,
    expiresAt,
}) => (
    [
        "TrustPlay wallet sign-in request",
        `Wallet: ${normalizeWalletAddress(walletAddress)}`,
        `Provider: ${normalizeWalletProvider(provider)}`,
        `WalletType: ${normalizeWalletType(walletType)}`,
        `Nonce: ${String(nonce || "").trim()}`,
        `ExpiresAt: ${new Date(expiresAt).toISOString()}`,
        `Purpose: ${WALLET_LOGIN_CHALLENGE_PURPOSE}`,
    ].join("\n")
);

const hashVerificationToken = (token) => (
    crypto.createHash("sha256").update(String(token)).digest("hex")
);

const resolveVerificationTtlMinutes = () => (
    Number.isFinite(EMAIL_VERIFY_TTL_MINUTES) && EMAIL_VERIFY_TTL_MINUTES > 0
        ? EMAIL_VERIFY_TTL_MINUTES
        : (60 * 24)
);

const generateVerificationTokenData = () => {
    const token = crypto.randomBytes(32).toString("hex");
    const ttlMinutes = resolveVerificationTtlMinutes();

    return {
        token,
        hash: hashVerificationToken(token),
        expireAt: new Date(Date.now() + ttlMinutes * 60 * 1000)
    };
};

const generateSixDigitCode = () => String(Math.floor(100000 + (Math.random() * 900000)));

const hashCodeValue = (value) => (
    crypto.createHash("sha256").update(String(value)).digest("hex")
);

const sendVerificationEmail = async (email, token, username) => {
    const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
    const verifyUrl = `${frontendUrl}/verify-email/${token}`;
    const template = buildVerificationEmail({
        verifyUrl,
        username,
        ttlMinutes: resolveVerificationTtlMinutes()
    });

    await sendEmail({
        email,
        subject: template.subject,
        html: template.html,
        message: template.text
    });
};

const sendVerificationCodeEmail = async ({ email, username, code, ttlMinutes, intro, title }) => {
    const template = buildVerificationCodeEmail({
        username,
        code,
        ttlMinutes,
        intro,
        title,
    });

    await sendEmail({
        email,
        subject: template.subject,
        html: template.html,
        message: template.text
    });
};

const toSafeUserPayload = (user) => ({
    _id: user._id,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    photo: user.photo || "",
    providers: user.providers || [],
    wallets: user.wallets || [],
    primaryWallet: user.primaryWallet || user.wallets?.[0] || null,
    walletProvider: user.walletProvider || "legacy",
    walletLinkedAt: user.walletLinkedAt || null,
    walletStatus: user.walletStatus || "legacy",
    walletMigrationVersion: Number(user.walletMigrationVersion || 0),
    sponsor: user.sponsor || null,
    sponsorships: user.sponsorships || [],
    isLoggedIn: Boolean(user.isLoggedIn),
    isVerified: Boolean(user.isVerified),
    isActive: user.isActive !== false,
    marketingConsent: user.marketingConsent || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
});

const parseBooleanEnv = (value, fallback) => {
    if (value === undefined || value === null) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
};

const isProductionEnv = () => String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const isSameDomainDeployment = () => parseBooleanEnv(process.env.AUTH_SAME_DOMAIN, true);

const buildAuthCookieOptions = () => {
    const isProduction = isProductionEnv();
    const sameDomain = isSameDomainDeployment();
    const sameSite = isProduction && !sameDomain ? "none" : "lax";

    return {
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: isProduction,
        sameSite
    };
};

const extractAuthTokenFromRequest = (req) => {
    const authHeader = req?.headers?.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken && bearerToken !== "none") return bearerToken;
    }

    const cookieToken = typeof req?.cookies?.token === "string"
        ? req.cookies.token.trim()
        : "";

    if (cookieToken && cookieToken !== "none") return cookieToken;
    return "";
};

const createWalletLoginChallengePayload = ({ walletAddress, provider, walletType }) => {
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    const normalizedProvider = normalizeWalletProvider(provider);
    const normalizedWalletType = normalizeWalletType(walletType);
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expiresAt = new Date(Date.now() + (WALLET_LOGIN_CHALLENGE_TTL_SECONDS * 1000));
    const message = buildWalletLoginChallengeMessage({
        walletAddress: normalizedWalletAddress,
        provider: normalizedProvider,
        walletType: normalizedWalletType,
        nonce,
        expiresAt,
    });

    const challengeToken = jwt.sign(
        {
            purpose: WALLET_LOGIN_CHALLENGE_PURPOSE,
            walletAddress: normalizedWalletAddress,
            provider: normalizedProvider,
            walletType: normalizedWalletType,
            nonce,
            message,
            expiresAt: expiresAt.toISOString(),
        },
        process.env.SECRET_JWT_KEY,
        { expiresIn: WALLET_LOGIN_CHALLENGE_TTL_SECONDS }
    );

    return {
        challengeToken,
        message,
        nonce,
        expiresAt: expiresAt.toISOString(),
    };
};

const findUserByWalletAddress = async (walletAddress) => {
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    if (!normalizedWalletAddress) return { user: null, matchedBy: null, identity: null };

    const identity = await WalletIdentity.findOne({ address: normalizedWalletAddress });
    if (identity?.userId && identity.status === "active" && identity.isVerified === true) {
        const user = await User.findById(identity.userId);
        if (user) {
            return { user, matchedBy: "wallet_identity", identity };
        }
    }

    if (identity && (identity.status !== "active" || identity.isVerified !== true || identity.removedAt)) {
        return { user: null, matchedBy: null, identity };
    }

    const primaryUser = await User.findOne({ primaryWallet: normalizedWalletAddress });
    if (primaryUser) {
        return { user: primaryUser, matchedBy: "primary_wallet", identity: null };
    }

    const legacyUser = await User.findOne({ wallets: normalizedWalletAddress });
    if (legacyUser) {
        return { user: legacyUser, matchedBy: "legacy_wallets", identity: null };
    }

    return { user: null, matchedBy: null, identity: null };
};

const buildUniqueWalletUsername = async (walletAddress) => {
    const seed = normalizeWalletAddress(walletAddress).replace(/^0x/, "").slice(0, 10) || Date.now().toString(36);
    const base = `wallet_${seed}`;

    for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
        const candidate = `${base}${suffix}`;
        const existing = await User.findOne({ username: candidate }).select("_id").lean();
        if (!existing) return candidate;
    }

    return `wallet_${Date.now().toString(36)}`;
};

const buildUniqueWalletEmail = async (walletAddress) => {
    const seed = normalizeWalletAddress(walletAddress).replace(/^0x/, "") || Date.now().toString(36);
    const domain = "wallet.trustplay.local";

    for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const candidate = `wallet-${seed}${suffix}@${domain}`;
        const existing = await User.findOne({ email: candidate }).select("_id").lean();
        if (!existing) return candidate;
    }

    return `wallet-${Date.now().toString(36)}@${domain}`;
};

const createWalletFirstUser = async ({ walletAddress, provider }) => {
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    const username = await buildUniqueWalletUsername(normalizedWalletAddress);
    const email = await buildUniqueWalletEmail(normalizedWalletAddress);
    const normalizedProvider = normalizeWalletProvider(provider);

    const user = new User({
        username,
        email,
        role: "user",
        wallets: [normalizedWalletAddress],
        primaryWallet: normalizedWalletAddress,
        walletProvider: normalizedProvider,
        walletLinkedAt: new Date(),
        walletStatus: "active",
        walletMigrationVersion: 1,
        isLoggedIn: false,
        isVerified: true,
        photo: "",
        marketingConsent: {
            accepted: false,
            acceptedAt: null,
            source: "register_form",
        },
    });

    await user.save();
    return user;
};

const createWalletRegistrationTempToken = ({
    walletAddress,
    provider,
    walletType,
    privyWalletId,
    metadata = {},
}) => jwt.sign(
    {
        purpose: WALLET_REGISTRATION_TEMP_PURPOSE,
        walletAddress: normalizeWalletAddress(walletAddress),
        provider: normalizeWalletProvider(provider),
        walletType: normalizeWalletType(walletType),
        privyWalletId: String(privyWalletId || "").trim(),
        metadata,
    },
    process.env.SECRET_JWT_KEY,
    { expiresIn: WALLET_REGISTRATION_TEMP_TTL_SECONDS }
);

const createWalletEmailCodeToken = ({
    userId,
    walletAddress,
    provider,
    walletType,
    privyWalletId,
    metadata = {},
    mode = "new_user",
    codeHash,
}) => jwt.sign(
    {
        purpose: WALLET_EMAIL_CODE_PURPOSE,
        userId: String(userId || ""),
        walletAddress: normalizeWalletAddress(walletAddress),
        provider: normalizeWalletProvider(provider),
        walletType: normalizeWalletType(walletType),
        privyWalletId: String(privyWalletId || "").trim(),
        metadata,
        mode,
        codeHash,
    },
    process.env.SECRET_JWT_KEY,
    { expiresIn: WALLET_EMAIL_CODE_TTL_SECONDS }
);

const resolveWalletRegistrationTempToken = (tempToken) => {
    const decoded = jwt.verify(tempToken, process.env.SECRET_JWT_KEY);
    if (!decoded || decoded.purpose !== WALLET_REGISTRATION_TEMP_PURPOSE) {
        throw new Error("INVALID_WALLET_REGISTRATION_TOKEN");
    }
    return decoded;
};

const resolveWalletEmailCodeToken = (verificationToken) => {
    const decoded = jwt.verify(verificationToken, process.env.SECRET_JWT_KEY);
    if (!decoded || decoded.purpose !== WALLET_EMAIL_CODE_PURPOSE) {
        throw new Error("INVALID_WALLET_EMAIL_CODE_TOKEN");
    }
    return decoded;
};

const ensureWalletOwnershipForUser = async ({
    user,
    walletAddress,
    provider,
    walletType,
    privyWalletId,
    metadata = {},
}) => {
    const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
    const normalizedProvider = normalizeWalletProvider(provider);
    const normalizedWalletType = normalizeWalletType(walletType);

    if (!user || !normalizedWalletAddress) return;

    const existingIdentity = await WalletIdentity.findOne({
        userId: user._id,
        address: normalizedWalletAddress,
        status: "active",
        isVerified: true,
    });

    if (existingIdentity) {
        if (!existingIdentity.isPrimary) {
            await setPrimaryWallet({
                userId: user._id,
                walletAddress: normalizedWalletAddress,
                skipVerificationCheck: true,
            });
        }
        return;
    }

    if (normalizedProvider === "privy" || normalizedWalletType === "embedded") {
        await syncPrivyWalletIdentity({
            userId: user._id,
            walletAddress: normalizedWalletAddress,
            privyWalletId: String(privyWalletId || "").trim(),
            metadata,
        });
        await setPrimaryWallet({
            userId: user._id,
            walletAddress: normalizedWalletAddress,
            skipVerificationCheck: true,
        });
        return;
    }

    await linkLegacyWalletToUser({
        userId: user._id,
        walletAddress: normalizedWalletAddress,
        source: "wallet_login",
        provider: normalizedProvider,
        metadata: {
            ...metadata,
            walletType: normalizedWalletType,
            linkedMode: "wallet_login",
        },
    });

    await setPrimaryWallet({
        userId: user._id,
        walletAddress: normalizedWalletAddress,
        skipVerificationCheck: true,
    });
};

const resolveWalletLoginChallenge = (challengeToken) => {
    const decoded = jwt.verify(challengeToken, process.env.SECRET_JWT_KEY);
    if (!decoded || decoded.purpose !== WALLET_LOGIN_CHALLENGE_PURPOSE) {
        throw new Error("INVALID_WALLET_LOGIN_CHALLENGE");
    }
    return decoded;
};

const normalizePhoneCountryCode = (value) => (
    typeof value === "string" ? value.trim() : ""
);

const normalizePhoneNationalNumber = (value) => (
    typeof value === "string" ? value.replace(/\D+/g, "") : ""
);

const isTrustedWalletLogin = ({ provider, walletType }) => {
    const normalizedProvider = normalizeWalletProvider(provider);
    const normalizedWalletType = normalizeWalletType(walletType);

    return normalizedProvider === "privy" || normalizedWalletType === "embedded";
};

const userNeedsWalletProfileCompletion = (user) => {
    const normalizedUsername = typeof user?.username === "string" ? user.username.trim() : "";
    const normalizedPhoneCountry = typeof user?.phone?.countryCode === "string" ? user.phone.countryCode.trim() : "";
    const normalizedPhoneNational = typeof user?.phone?.nationalNumber === "string" ? user.phone.nationalNumber.replace(/\D+/g, "") : "";

    return !normalizedUsername || !normalizedPhoneCountry || !normalizedPhoneNational;
};

const findExistingUserForWalletProfile = async ({ username, email }) => {
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    const userByEmail = normalizedEmail ? await User.findOne({ email: normalizedEmail }) : null;
    const userByUsername = normalizedUsername ? await User.findOne({ username: normalizedUsername }) : null;

    if (userByEmail && userByUsername && String(userByEmail._id) !== String(userByUsername._id)) {
        const conflict = new Error("PROFILE_MATCH_CONFLICT");
        conflict.code = "PROFILE_MATCH_CONFLICT";
        throw conflict;
    }

    return userByEmail || userByUsername || null;
};

const issueWalletEmailCode = async ({
    user,
    walletAddress,
    provider,
    walletType,
    privyWalletId,
    recipientEmail,
    metadata = {},
    mode = "new_user",
    intro,
    title,
}) => {
    const code = generateSixDigitCode();
    const codeHash = hashCodeValue(code);
    const verificationToken = createWalletEmailCodeToken({
        userId: user._id,
        walletAddress,
        provider,
        walletType,
        privyWalletId,
        metadata,
        mode,
        codeHash,
    });

    await sendVerificationCodeEmail({
        email: String(recipientEmail || user.email || "").trim().toLowerCase(),
        username: user.username,
        code,
        ttlMinutes: Math.floor(WALLET_EMAIL_CODE_TTL_SECONDS / 60),
        intro,
        title,
    });

    return {
        verificationToken,
        email: user.email,
    };
};

exports.login = async (req, res) => {
    try {
        const { email, password, legalAcceptance } = req.body;

        // 1. Input Validation
        if (!email || !password) {
            return res.status(400).json({ msj: "Faltan correo o contraseña" });
        }

        // Buscar usuario por correo
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ error: "Credenciales incorrectas" }); // Mensaje genérico por seguridad
        }

        const hasLocalPassword = typeof user.password === "string" && user.password.trim().length > 0;
        if (!hasLocalPassword) {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

        // Verificar contraseña
        if (user && (await user.matchPassword(password))) {

            // Verificar si el correo está confirmado
            if (!user.isVerified) {
                return res.status(401).json({
                    error: "Debes verificar tu correo electrónico antes de iniciar sesión.",
                    code: "EMAIL_NOT_VERIFIED"
                });
            }

            const legalResolution = await applyLegalAcceptanceIfRequired({
                user,
                legalAcceptancePayload: legalAcceptance,
                req,
                source: 'login_form'
            });

            const pendingDocuments = resolvePendingDocumentsFromLegalResolution(legalResolution);
            if (!legalResolution.ok && didClientExplicitlyAcceptLegal(legalAcceptance)) {
                return res.status(400).json(buildLegalRequiredErrorPayload(legalResolution));
            }

            // Marcar usuario como logueado
            user.isLoggedIn = true;
            await user.save();

            // Generar Token JWT
            const token = jwt.sign(
            {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                wallet: user.primaryWallet || (user.wallets && user.wallets.length > 0 ? user.wallets[0] : null)
            },
                process.env.SECRET_JWT_KEY,
                {
                    expiresIn: process.env.TOKEN_EXPIRE || "24h",
                }
            );

            const options = buildAuthCookieOptions();

            const exposeTokenInBody = process.env.EXPOSE_TOKEN_IN_BODY !== "false";
            const responsePayload = {
                Welcome: `Bienvenido a ODDSWIN ${user.username}`,
                user: toSafeUserPayload(user),
                legal: buildLegalStatusPayload(pendingDocuments)
            };

            if (exposeTokenInBody) {
                responsePayload.token = token;
            }

            res.status(200).cookie('token', token, options).json(responsePayload);

        } else {
            return res.status(401).json({ error: "Credenciales incorrectas" });
        }

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

exports.walletLoginChallenge = async (req, res) => {
    try {
        const { walletAddress, provider, walletType } = req.body || {};
        const normalizedWalletAddress = normalizeWalletAddress(walletAddress);

        if (!normalizedWalletAddress) {
            return res.status(400).json({ error: "Wallet inválida.", code: "INVALID_WALLET_ADDRESS" });
        }

        const challenge = createWalletLoginChallengePayload({
            walletAddress: normalizedWalletAddress,
            provider,
            walletType,
        });

        return res.status(200).json({
            ok: true,
            walletAddress: normalizedWalletAddress,
            provider: normalizeWalletProvider(provider),
            walletType: normalizeWalletType(walletType),
            ...challenge,
        });
    } catch (error) {
        console.error("Error generando challenge de login wallet:", error);
        return res.status(500).json({ error: "No se pudo generar el challenge de login." });
    }
};

exports.walletLoginVerify = async (req, res) => {
    try {
        const {
            walletAddress,
            provider,
            walletType,
            signature,
            challengeToken,
            privyWalletId,
            metadata,
            legalAcceptance,
        } = req.body || {};

        const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
        const normalizedProvider = normalizeWalletProvider(provider);
        const normalizedWalletType = normalizeWalletType(walletType);

        if (!normalizedWalletAddress) {
            return res.status(400).json({ error: "Wallet inválida.", code: "INVALID_WALLET_ADDRESS" });
        }

        let decodedChallenge;
        try {
            decodedChallenge = resolveWalletLoginChallenge(challengeToken);
        } catch (challengeError) {
            return res.status(401).json({
                error: "Challenge inválido o expirado.",
                code: "INVALID_WALLET_LOGIN_CHALLENGE",
            });
        }

        if (
            normalizeWalletAddress(decodedChallenge.walletAddress) !== normalizedWalletAddress
            || normalizeWalletProvider(decodedChallenge.provider) !== normalizedProvider
            || normalizeWalletType(decodedChallenge.walletType) !== normalizedWalletType
        ) {
            return res.status(400).json({
                error: "Los datos firmados no coinciden con la solicitud.",
                code: "WALLET_LOGIN_PAYLOAD_MISMATCH",
            });
        }

        const recoveredWallet = ethers.verifyMessage(String(decodedChallenge.message || ""), String(signature || "").trim());
        if (normalizeWalletAddress(recoveredWallet) !== normalizedWalletAddress) {
            return res.status(401).json({
                error: "La firma no corresponde a la wallet enviada.",
                code: "INVALID_WALLET_SIGNATURE",
            });
        }

        const existingMatch = await findUserByWalletAddress(normalizedWalletAddress);
        let user = existingMatch.user;
        const normalizedLoginEmail = typeof metadata?.email === "string"
            ? metadata.email.trim().toLowerCase()
            : "";

        if (!user && isTrustedWalletLogin({ provider: normalizedProvider, walletType: normalizedWalletType }) && normalizedLoginEmail) {
            user = await User.findOne({ email: normalizedLoginEmail });
        }

        const isNewUser = !user;

        if (!user) {
            const tempToken = createWalletRegistrationTempToken({
                walletAddress: normalizedWalletAddress,
                provider: normalizedProvider,
                walletType: normalizedWalletType,
                privyWalletId,
                metadata,
            });

            return res.status(200).json({
                status: "REQUIRE_PROFILE",
                tempToken,
                walletAddress: normalizedWalletAddress,
                provider: normalizedProvider,
                walletType: normalizedWalletType,
                email: normalizedLoginEmail,
            });
        }

        if (!user.isVerified) {
            if (isTrustedWalletLogin({ provider: normalizedProvider, walletType: normalizedWalletType })) {
                await ensureWalletOwnershipForUser({
                    user,
                    walletAddress: normalizedWalletAddress,
                    provider: normalizedProvider,
                    walletType: normalizedWalletType,
                    privyWalletId,
                    metadata: {
                        ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
                        source: "wallet_login_existing_unverified_privy",
                    },
                });

                user.isVerified = true;
                user.isLoggedIn = true;
                await user.save();

                const sessionUser = await User.findById(user._id);
                if (!sessionUser) {
                    return res.status(404).json({ error: "Usuario no encontrado." });
                }

                return sendTokenResponse(sessionUser, 200, res, { pendingDocuments: [] });
            }

            const codePayload = await issueWalletEmailCode({
                user,
                walletAddress: normalizedWalletAddress,
                provider: normalizedProvider,
                walletType: normalizedWalletType,
                privyWalletId,
                metadata: {
                    ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
                    source: "wallet_login_existing_unverified",
                },
                mode: "existing_unverified_user",
                intro: "Usa este codigo para verificar tu correo y terminar el ingreso con tu wallet.",
                title: "Verifica tu correo para ingresar",
            });

            return res.status(200).json({
                status: "VERIFY_CODE_REQUIRED",
                verificationToken: codePayload.verificationToken,
                email: codePayload.email,
            });
        }

        await ensureWalletOwnershipForUser({
            user,
            walletAddress: normalizedWalletAddress,
            provider: normalizedProvider,
            walletType: normalizedWalletType,
            privyWalletId,
            metadata: {
                ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
                loginProvider: normalizedProvider,
                loginWalletType: normalizedWalletType,
                loginMatchedBy: existingMatch.matchedBy || (isNewUser ? "new_wallet_user" : "existing_wallet_user"),
            },
        });

        const sessionUser = await User.findById(user._id);
        if (!sessionUser) {
            return res.status(404).json({ error: "Usuario no encontrado después del login wallet." });
        }

        const legalResolution = await applyLegalAcceptanceIfRequired({
            user: sessionUser,
            legalAcceptancePayload: legalAcceptance,
            req,
            source: "wallet_login",
        });
        const pendingDocuments = resolvePendingDocumentsFromLegalResolution(legalResolution);
        if (!legalResolution.ok && didClientExplicitlyAcceptLegal(legalAcceptance)) {
            return res.status(400).json(buildLegalRequiredErrorPayload(legalResolution));
        }

        sessionUser.isLoggedIn = true;
        await sessionUser.save();

        return sendTokenResponse(sessionUser, isNewUser ? 201 : 200, res, { pendingDocuments });
    } catch (error) {
        console.error("Error verificando login wallet:", error);
        return res.status(500).json({ error: "Error interno del servidor en login wallet." });
    }
};

exports.completeWalletRegistration = async (req, res) => {
    try {
        const {
            tempToken,
            username,
            email,
            phone,
            marketingConsent,
            legalAcceptance,
        } = req.body || {};

        let decoded;
        try {
            decoded = resolveWalletRegistrationTempToken(tempToken);
        } catch (_) {
            return res.status(401).json({
                error: "Solicitud de registro inválida o expirada.",
                code: "INVALID_WALLET_REGISTRATION_TOKEN",
            });
        }

        const normalizedWalletAddress = normalizeWalletAddress(decoded.walletAddress);
        const normalizedProvider = normalizeWalletProvider(decoded.provider);
        const normalizedWalletType = normalizeWalletType(decoded.walletType);
        const trustedWalletLogin = isTrustedWalletLogin({
            provider: normalizedProvider,
            walletType: normalizedWalletType,
        });
        const normalizedUsername = typeof username === "string" ? username.trim() : "";
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
        const normalizedPhoneCountry = normalizePhoneCountryCode(phone?.countryCode);
        const normalizedPhoneNational = normalizePhoneNationalNumber(phone?.nationalNumber);
        const normalizedPhoneE164 = `${normalizedPhoneCountry}${normalizedPhoneNational}`;

        const walletMatch = await findUserByWalletAddress(normalizedWalletAddress);
        if (walletMatch.user) {
            if (!walletMatch.user.isVerified) {
                return res.status(409).json({
                    error: "La wallet ya está vinculada a una cuenta pendiente de verificación.",
                    code: "EMAIL_NOT_VERIFIED",
                    email: walletMatch.user.email || "",
                });
            }
            return res.status(409).json({
                error: "La wallet ya está vinculada a un usuario existente.",
                code: "WALLET_ALREADY_REGISTERED",
            });
        }

        const existingUserByEmail = normalizedEmail
            ? await User.findOne({ email: normalizedEmail })
            : null;

        if (existingUserByEmail) {
            if (userNeedsWalletProfileCompletion(existingUserByEmail)) {
                if (!normalizedUsername || !normalizedPhoneCountry || !normalizedPhoneNational) {
                    return res.status(200).json({
                        success: true,
                        status: "REQUIRE_NEW_PROFILE",
                        email: normalizedEmail,
                        message: "Completa username, celular y acepta los documentos legales para continuar con esta cuenta.",
                    });
                }

                const existingUserByUsername = await User.findOne({ username: normalizedUsername });
                if (existingUserByUsername && String(existingUserByUsername._id) !== String(existingUserByEmail._id)) {
                    return res.status(409).json({
                        error: "El username ya existe. Usa otro username.",
                        code: "USERNAME_ALREADY_EXISTS",
                    });
                }

                const legalResolution = await applyLegalAcceptanceIfRequired({
                    user: existingUserByEmail,
                    legalAcceptancePayload: legalAcceptance,
                    req,
                    source: "wallet_login_profile_existing_user",
                });

                const pendingDocuments = resolvePendingDocumentsFromLegalResolution(legalResolution);
                if (!legalResolution.ok) {
                    return res.status(400).json({
                        msj: legalResolution.msg || "Debes aceptar los documentos legales vigentes para continuar.",
                        code: "LEGAL_ACCEPTANCE_REQUIRED",
                        legalVersion: pendingDocuments[0]?.version || "",
                        pendingDocuments,
                    });
                }

                existingUserByEmail.username = normalizedUsername;
                existingUserByEmail.phone = {
                    countryCode: normalizedPhoneCountry,
                    nationalNumber: normalizedPhoneNational,
                    e164: normalizedPhoneE164,
                };
                existingUserByEmail.marketingConsent = {
                    accepted: marketingConsent?.accepted === true || legalAcceptance?.accepted === true,
                    acceptedAt: marketingConsent?.accepted === true || legalAcceptance?.accepted === true ? new Date() : (existingUserByEmail.marketingConsent?.acceptedAt || null),
                    source: "register_form",
                };
                await existingUserByEmail.save();
            }

            if (trustedWalletLogin) {
                await ensureWalletOwnershipForUser({
                    user: existingUserByEmail,
                    walletAddress: normalizedWalletAddress,
                    provider: normalizedProvider,
                    walletType: normalizedWalletType,
                    privyWalletId: decoded.privyWalletId,
                    metadata: {
                        ...(decoded.metadata || {}),
                        completedFrom: "wallet_login_profile_existing_user_privy",
                    },
                });

                existingUserByEmail.isVerified = true;
                existingUserByEmail.isLoggedIn = true;
                await existingUserByEmail.save();

                const sessionUser = await User.findById(existingUserByEmail._id);
                if (!sessionUser) {
                    return res.status(404).json({ error: "Usuario no encontrado." });
                }

                return sendTokenResponse(sessionUser, 200, res, { pendingDocuments: [] });
            }

            let codePayload;
            try {
                codePayload = await issueWalletEmailCode({
                    user: existingUserByEmail,
                    recipientEmail: normalizedEmail,
                    walletAddress: normalizedWalletAddress,
                    provider: normalizedProvider,
                    walletType: normalizedWalletType,
                    privyWalletId: decoded.privyWalletId,
                    metadata: {
                        ...(decoded.metadata || {}),
                        completedFrom: "wallet_login_profile_existing_user",
                    },
                    mode: "existing_user_link",
                    intro: "Usa este codigo para autorizar la vinculacion de esta nueva wallet a tu cuenta existente.",
                    title: "Autoriza la vinculacion de tu wallet",
                });
            } catch (sendError) {
                console.error("Error enviando código para vincular wallet a cuenta existente:", sendError);
                return res.status(502).json({
                    error: "No se pudo enviar el código al correo de la cuenta existente.",
                    code: "EMAIL_CODE_SEND_FAILED",
                });
            }

            return res.status(200).json({
                success: true,
                status: "VERIFY_CODE_REQUIRED",
                email: codePayload.email,
                verificationToken: codePayload.verificationToken,
                message: "Te enviamos un codigo de verificacion para vincular esta wallet a tu cuenta.",
            });
        }

        if (!normalizedUsername || !normalizedPhoneCountry || !normalizedPhoneNational) {
            return res.status(200).json({
                success: true,
                status: "REQUIRE_NEW_PROFILE",
                email: normalizedEmail,
                message: "Ese correo no existe todavía. Completa username y celular para crear la cuenta.",
            });
        }

        const legalValidation = await ensureNewUserLegalAcceptance({
            legalAcceptancePayload: legalAcceptance
        });
        if (!legalValidation.ok) {
            const pendingDocuments = Array.isArray(legalValidation.pendingDocuments)
                ? legalValidation.pendingDocuments
                : [];
            return res.status(400).json({
                msj: legalValidation.msg,
                code: "LEGAL_ACCEPTANCE_REQUIRED",
                legalVersion: pendingDocuments[0]?.version || "",
                pendingDocuments
            });
        }

        const existingUserByUsername = await User.findOne({ username: normalizedUsername });
        if (existingUserByUsername) {
            return res.status(409).json({
                error: "El username ya existe. Usa otro username o ingresa el correo de una cuenta existente.",
                code: "USERNAME_ALREADY_EXISTS",
            });
        }

        const user = new User({
            username: normalizedUsername,
            email: normalizedEmail,
            role: "user",
            phone: {
                countryCode: normalizedPhoneCountry,
                nationalNumber: normalizedPhoneNational,
                e164: normalizedPhoneE164,
            },
            wallets: [normalizedWalletAddress],
            primaryWallet: normalizedWalletAddress,
            walletProvider: normalizedProvider,
            walletLinkedAt: new Date(),
            walletStatus: "active",
            walletMigrationVersion: 1,
            isLoggedIn: false,
            isVerified: false,
            marketingConsent: {
                accepted: marketingConsent?.accepted === true || legalAcceptance?.accepted === true,
                acceptedAt: marketingConsent?.accepted === true || legalAcceptance?.accepted === true ? new Date() : null,
                source: "register_form",
            },
        });

        await user.save();

        await ensureWalletOwnershipForUser({
            user,
            walletAddress: normalizedWalletAddress,
            provider: normalizedProvider,
            walletType: normalizedWalletType,
            privyWalletId: decoded.privyWalletId,
            metadata: {
                ...(decoded.metadata || {}),
                completedFrom: "wallet_login_profile_new_user",
            },
        });

        await registerCurrentLegalAcceptanceForNewUser({
            userId: user._id,
            req,
            source: "wallet_login_registration"
        });

        if (trustedWalletLogin) {
            user.isVerified = true;
            user.isLoggedIn = true;
            await user.save();

            const sessionUser = await User.findById(user._id);
            if (!sessionUser) {
                return res.status(404).json({ error: "Usuario no encontrado." });
            }

            return sendTokenResponse(sessionUser, 201, res, { pendingDocuments: [] });
        }

        let codePayload;
        try {
            codePayload = await issueWalletEmailCode({
                user,
                recipientEmail: normalizedEmail,
                walletAddress: normalizedWalletAddress,
                provider: normalizedProvider,
                walletType: normalizedWalletType,
                privyWalletId: decoded.privyWalletId,
                metadata: {
                    ...(decoded.metadata || {}),
                    completedFrom: "wallet_login_profile_new_user",
                },
                mode: "new_user",
                intro: "Usa este codigo para verificar tu correo y activar tu cuenta.",
                title: "Activa tu cuenta con este codigo",
            });
        } catch (sendError) {
            console.error("Error enviando código para cuenta nueva por wallet:", sendError);
            return res.status(502).json({
                error: "La cuenta fue preparada pero no se pudo enviar el código al correo.",
                code: "EMAIL_CODE_SEND_FAILED",
            });
        }

        return res.status(201).json({
            success: true,
            status: "VERIFY_CODE_REQUIRED",
            email: codePayload.email,
            verificationToken: codePayload.verificationToken,
            message: "Te enviamos un codigo de verificacion para activar tu cuenta.",
        });
    } catch (error) {
        console.error("Error completando registro con wallet:", error);
        return res.status(500).json({ error: "Error interno completando el registro con wallet." });
    }
};

exports.confirmWalletEmailCode = async (req, res) => {
    try {
        const { verificationToken, code } = req.body || {};

        let decoded;
        try {
            decoded = resolveWalletEmailCodeToken(verificationToken);
        } catch (_) {
            return res.status(401).json({
                error: "Código inválido o expirado.",
                code: "INVALID_WALLET_EMAIL_CODE_TOKEN",
            });
        }

        if (hashCodeValue(String(code || "").trim()) !== String(decoded.codeHash || "")) {
            return res.status(401).json({
                error: "El código no es correcto.",
                code: "INVALID_VERIFICATION_CODE",
            });
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado." });
        }

        if (decoded.mode === "existing_user_link") {
            await ensureWalletOwnershipForUser({
                user,
                walletAddress: decoded.walletAddress,
                provider: decoded.provider,
                walletType: decoded.walletType,
                privyWalletId: decoded.privyWalletId,
                metadata: {
                    ...(decoded.metadata || {}),
                    confirmedVia: "email_code_existing_user",
                },
            });
        } else if (!user.isVerified) {
            user.isVerified = true;
        }

        const refreshedUser = await User.findById(decoded.userId);
        if (!refreshedUser) {
            return res.status(404).json({ error: "Usuario no encontrado." });
        }

        refreshedUser.isVerified = true;
        refreshedUser.isLoggedIn = true;
        await refreshedUser.save();

        return sendTokenResponse(refreshedUser, 200, res, { pendingDocuments: [] });
    } catch (error) {
        console.error("Error confirmando código de wallet:", error);
        if (error?.code === "WALLET_ALREADY_LINKED" || error?.message === "WALLET_ALREADY_LINKED") {
            return res.status(409).json({
                error: "Esta wallet ya está vinculada a otra cuenta.",
                code: "WALLET_ALREADY_LINKED",
            });
        }
        if (error?.message === "WALLET_IDENTITY_NOT_FOUND") {
            return res.status(404).json({
                error: "La wallet ya no está disponible para vinculación.",
                code: "WALLET_IDENTITY_NOT_FOUND",
            });
        }
        if (error?.message === "USER_NOT_FOUND") {
            return res.status(404).json({
                error: "Usuario no encontrado.",
                code: "USER_NOT_FOUND",
            });
        }
        return res.status(500).json({ error: "Error interno confirmando el código." });
    }
};

exports.resendWalletEmailCode = async (req, res) => {
    try {
        const { verificationToken } = req.body || {};
        let decoded;
        try {
            decoded = resolveWalletEmailCodeToken(verificationToken);
        } catch (_) {
            return res.status(401).json({
                error: "La solicitud de reenvío expiró.",
                code: "INVALID_WALLET_EMAIL_CODE_TOKEN",
            });
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado." });
        }

        const codePayload = await issueWalletEmailCode({
            user,
            walletAddress: decoded.walletAddress,
            provider: decoded.provider,
            walletType: decoded.walletType,
            privyWalletId: decoded.privyWalletId,
            metadata: decoded.metadata || {},
            mode: decoded.mode || "new_user",
            intro: decoded.mode === "existing_user_link"
                ? "Usa este codigo para autorizar la vinculacion de esta nueva wallet a tu cuenta existente."
                : "Usa este codigo para verificar tu correo y continuar.",
            title: decoded.mode === "existing_user_link"
                ? "Autoriza la vinculacion de tu wallet"
                : "Verifica tu correo",
        });

        return res.status(200).json({
            success: true,
            status: "VERIFY_CODE_REQUIRED",
            email: codePayload.email,
            verificationToken: codePayload.verificationToken,
            message: "Te enviamos un nuevo código de verificación.",
        });
    } catch (error) {
        console.error("Error reenviando código de wallet:", error);
        return res.status(500).json({ error: "Error interno reenviando el código." });
    }
};

exports.logout = async (req, res) => {
    try {
        const token = extractAuthTokenFromRequest(req);
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
                const userId = decoded?.id;
                if (userId) {
                    await User.findByIdAndUpdate(userId, { isLoggedIn: false });
                }
            } catch (_) {
                // Si el token es inválido/expirado, continuamos con logout de cookie sin romper respuesta.
            }
        }

        res.cookie('token', 'none', {
            expires: new Date(Date.now() + 10 * 1000),
            httpOnly: true
        });
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        console.error("Error en logout:", error);
        res.status(500).json({ error: "Error al cerrar sesión" });
    }
};

// --- Social Login Helpers ---

const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            wallet: user.primaryWallet || (user.wallets && user.wallets.length > 0 ? user.wallets[0] : null)
        },
        process.env.SECRET_JWT_KEY,
        { expiresIn: process.env.TOKEN_EXPIRE || "24h" }
    );
};

const sendTokenResponse = (user, statusCode, res, options = {}) => {
    const pendingDocuments = Array.isArray(options?.pendingDocuments) ? options.pendingDocuments : [];
    const token = generateToken(user);
    const exposeTokenInBody = process.env.EXPOSE_TOKEN_IN_BODY !== "false";
    const cookieOptions = buildAuthCookieOptions();
    const responsePayload = {
        Welcome: `Bienvenido a ODDSWIN ${user.username}`,
        user: toSafeUserPayload(user),
        legal: buildLegalStatusPayload(pendingDocuments)
    };

    if (exposeTokenInBody) {
        responsePayload.token = token;
    }

    res.status(statusCode).cookie('token', token, cookieOptions).json(responsePayload);
};
