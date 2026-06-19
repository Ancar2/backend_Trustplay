const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const WalletIdentity = require("../../models/wallet/walletIdentity.model");
const User = require("../../models/user.model");
const { isFeatureEnabled } = require("../system/featureFlags.service");
const {
    normalizeWalletAddress,
    normalizeWalletProvider,
    normalizeWalletType,
    setPrimaryWallet,
    listWalletIdentitiesForUser,
    identityToPayload,
} = require("./walletIdentity.service");
const { createLogger } = require("../system/logger.service");

const logger = createLogger("privy-wallet");

const isPrivyEnabled = () => isFeatureEnabled("privyEmbeddedWalletsEnabled");

const normalizeString = (value) => String(value ?? "").trim();

const readMultilineEnv = (value) => normalizeString(value).replace(/\\n/g, "\n");

const getPrivyJwtSigningSecret = () => (
    normalizeString(process.env.PRIVY_JWT_SIGNING_SECRET)
    || normalizeString(process.env.PRIVY_APP_SECRET)
);

const getPrivyJwtPrivateKeyPem = () => readMultilineEnv(process.env.PRIVY_JWT_PRIVATE_KEY);

const getPrivyJwtPublicKeyPem = () => readMultilineEnv(process.env.PRIVY_JWT_PUBLIC_KEY);

const getPrivyJwtPublicCertificatePem = () => readMultilineEnv(process.env.PRIVY_JWT_PUBLIC_CERTIFICATE);

const getPrivyJwtKeyId = () => normalizeString(process.env.PRIVY_JWT_KEY_ID);

const getPrivyJwtIssuer = () => {
    const rawIssuer = normalizeString(process.env.PRIVY_JWT_ISSUER)
        || normalizeString(process.env.FRONTEND_URL)
        || "trustplay";

    // Standardize: remove trailing slash if present
    return rawIssuer.replace(/\/$/, "");
};

const getPrivyJwtAudience = () => (
    normalizeString(process.env.PRIVY_JWT_AUDIENCE)
    || normalizeString(process.env.PRIVY_APP_ID)
);

const exportPublicKeyDer = (publicKey) => (
    publicKey.export({ format: "der", type: "spki" })
);

const publicKeysMatch = (left, right) => {
    try {
        return exportPublicKeyDer(left).equals(exportPublicKeyDer(right));
    } catch {
        return false;
    }
};

const createPublicKeyFromSource = () => {
    const certificatePem = getPrivyJwtPublicCertificatePem();
    if (certificatePem) {
        return crypto.createPublicKey(certificatePem);
    }

    const publicKeyPem = getPrivyJwtPublicKeyPem();
    if (publicKeyPem) {
        return crypto.createPublicKey(publicKeyPem);
    }

    const privateKeyPem = getPrivyJwtPrivateKeyPem();
    if (privateKeyPem) {
        return crypto.createPublicKey(privateKeyPem);
    }

    return null;
};

const resolvePrivyJwtSigningConfig = () => {
    const privateKeyPem = getPrivyJwtPrivateKeyPem();
    if (privateKeyPem) {
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        const publicKey = crypto.createPublicKey(privateKey);
        const configuredPublicKeyPem = getPrivyJwtPublicKeyPem();

        if (configuredPublicKeyPem) {
            const configuredPublicKey = crypto.createPublicKey(configuredPublicKeyPem);
            if (!publicKeysMatch(publicKey, configuredPublicKey)) {
                logger.warn("privy_public_key_mismatch_ignored", {
                    detail: "PRIVY_JWT_PUBLIC_KEY no coincide con PRIVY_JWT_PRIVATE_KEY. Se derivara el JWKS desde la clave privada.",
                });
            }
        }

        const publicDer = exportPublicKeyDer(publicKey);
        const derivedKeyId = crypto.createHash("sha256").update(publicDer).digest("base64url");

        return {
            algorithm: "RS256",
            signingKey: privateKey,
            publicKey,
            keyId: getPrivyJwtKeyId() || derivedKeyId,
        };
    }

    const signingSecret = getPrivyJwtSigningSecret();
    if (!signingSecret) {
        const error = new Error("PRIVY_JWT_SIGNING_SECRET_NOT_AVAILABLE");
        error.code = "PRIVY_JWT_SIGNING_SECRET_NOT_AVAILABLE";
        throw error;
    }

    return {
        algorithm: "HS256",
        signingKey: signingSecret,
        publicKey: null,
        keyId: "",
    };
};

const buildPrivyJwks = () => {
    const privateKeyPem = getPrivyJwtPrivateKeyPem();
    if (!privateKeyPem) {
        const error = new Error("PRIVY_JWKS_NOT_CONFIGURED");
        error.code = "PRIVY_JWKS_NOT_CONFIGURED";
        throw error;
    }

    const signingConfig = resolvePrivyJwtSigningConfig();
    const jwk = signingConfig.publicKey.export({ format: "jwk" });
    const certificatePem = getPrivyJwtPublicCertificatePem();
    const certificatePublicKey = certificatePem ? crypto.createPublicKey(certificatePem) : null;
    const x5c = certificatePem && certificatePublicKey && publicKeysMatch(signingConfig.publicKey, certificatePublicKey)
        ? certificatePem
            .replace("-----BEGIN CERTIFICATE-----", "")
            .replace("-----END CERTIFICATE-----", "")
            .replace(/\s+/g, "")
        : null;

    if (certificatePem && !x5c) {
        logger.warn("privy_public_certificate_mismatch_ignored", {
            detail: "PRIVY_JWT_PUBLIC_CERTIFICATE no coincide con PRIVY_JWT_PRIVATE_KEY. Se omitira x5c del JWKS.",
        });
    }

    return {
        keys: [
            {
                ...jwk,
                use: "sig",
                alg: signingConfig.algorithm,
                kid: signingConfig.keyId,
                ...(x5c ? { x5c: [x5c] } : {}),
            }
        ]
    };
};

const buildPrivyBridgeToken = ({
    user,
    primaryWallet = null,
    source = "trustplay_privy_bridge",
}) => {
    const signingConfig = resolvePrivyJwtSigningConfig();
    const audience = getPrivyJwtAudience();
    const issuer = getPrivyJwtIssuer();

    if (!audience) {
        const error = new Error("PRIVY_JWT_AUDIENCE_NOT_AVAILABLE");
        error.code = "PRIVY_JWT_AUDIENCE_NOT_AVAILABLE";
        throw error;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const jwtId = crypto.randomUUID();
    const userId = String(user?._id || "");

    const payload = {
        sub: userId,
        aud: audience,
        aid: audience,
        iss: issuer,
        iat: nowInSeconds,
        nbf: nowInSeconds - 5,
        exp: nowInSeconds + (5 * 60),
        jti: jwtId,
        email: normalizeString(user?.email) || undefined,
        name: normalizeString(user?.username) || undefined,
        wallet: normalizeString(primaryWallet) || undefined,
        custom_metadata: {
            trustplayUserId: userId,
            role: normalizeString(user?.role) || "user",
            source: normalizeString(source) || "trustplay_privy_bridge",
        },
    };

    logger.info("issuing_privy_bridge_token", {
        sub: payload.sub,
        aud: payload.aud,
        iss: payload.iss,
        kid: signingConfig.keyId,
        alg: signingConfig.algorithm,
        hasEmail: Boolean(payload.email),
        hasWallet: Boolean(payload.wallet),
    });

    return jwt.sign(
        payload,
        signingConfig.signingKey,
        {
            algorithm: signingConfig.algorithm,
            keyid: signingConfig.keyId || undefined,
            header: {
                typ: "JWT",
            },
        }
    );
};

const syncPrivyWalletIdentity = async ({
    userId,
    walletAddress,
    privyWalletId = "",
    metadata = {},
}) => {
    if (!isPrivyEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    const existing = await WalletIdentity.findOne({ address });
    if (existing && String(existing.userId) !== String(user._id)) {
        const previousUser = await User.findById(existing.userId).select("_id primaryWallet wallets");
        const canReassign = (
            !previousUser
            || existing.status !== "active"
            || existing.isVerified !== true
            || Boolean(existing.removedAt)
        );

        if (!canReassign) {
            const error = new Error("WALLET_ALREADY_LINKED");
            error.code = "WALLET_ALREADY_LINKED";
            throw error;
        }
    }

    const now = new Date();
    const identity = existing || new WalletIdentity({
        userId: user._id,
        address,
    });

    identity.userId = user._id;
    identity.address = address;
    identity.provider = normalizeWalletProvider("privy");
    identity.walletType = normalizeWalletType("embedded");
    identity.status = "active";
    identity.isVerified = true;
    identity.isPrimary = Boolean(user.primaryWallet && normalizeWalletAddress(user.primaryWallet) === address)
        || (!normalizeWalletAddress(user.primaryWallet));
    identity.externalId = String(privyWalletId || identity.externalId || "").trim();
    identity.source = "privy_sync";
    identity.linkedAt = identity.linkedAt || now;
    identity.lastUsedAt = now;
    identity.challengeNonce = "";
    identity.challengeMessage = "";
    identity.challengeIssuedAt = null;
    identity.challengeExpiresAt = null;
    identity.challengeUsedAt = now;
    identity.removedAt = null;
    identity.metadata = {
        ...(existing?.metadata || {}),
        ...(metadata || {}),
        syncedVia: "privy",
        privyWalletId: String(privyWalletId || identity.externalId || ""),
        syncedAt: now.toISOString(),
    };

    await identity.save();

    const userWallets = Array.isArray(user.wallets) ? user.wallets : [];
    if (!userWallets.some((item) => normalizeWalletAddress(item) === address)) {
        user.wallets = [...userWallets, address];
    }

    if (!normalizeWalletAddress(user.primaryWallet)) {
        await setPrimaryWallet({
            userId: user._id,
            walletAddress: address,
            skipVerificationCheck: true,
        });
    } else if (identity.isPrimary) {
        user.primaryWallet = address;
        user.walletProvider = identity.provider;
        user.walletLinkedAt = user.walletLinkedAt || now;
        user.walletStatus = "active";
        await user.save();
    } else {
        await user.save();
    }

    const snapshot = await listWalletIdentitiesForUser(user._id);

    logger.info("privy_wallet_synced", {
        userId: String(user._id),
        address,
        privyWalletId: identity.externalId || "",
    });

    return {
        user,
        identity: identityToPayload(identity),
        snapshot,
    };
};

module.exports = {
    buildPrivyJwks,
    buildPrivyBridgeToken,
    isPrivyEnabled,
    resolvePrivyJwtSigningConfig,
    syncPrivyWalletIdentity,
};
