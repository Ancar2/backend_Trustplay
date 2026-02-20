const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const {
    ensureCurrentLegalAcceptanceForUser,
    ensureNewUserLegalAcceptance,
    registerCurrentLegalAcceptanceForNewUser
} = require("../services/legal/legal.service");

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

const toSafeUserPayload = (user) => ({
    _id: user._id,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    photo: user.photo || "",
    providers: user.providers || [],
    wallets: user.wallets || [],
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
            return res.status(401).json({ error: "Credenciales inválidas" }); // Mensaje genérico por seguridad
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

            if (!legalResolution.ok) {
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
                    wallet: user.wallets && user.wallets.length > 0 ? user.wallets[0] : null
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
                user: toSafeUserPayload(user)
            };

            if (exposeTokenInBody) {
                responsePayload.token = token;
            }

            res.status(200).cookie('token', token, options).json(responsePayload);

        } else {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

exports.logout = (req, res) => {
    res.cookie('token', 'none', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    res.status(200).json({ success: true, data: {} });
};

// --- Social Login Helpers ---

const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            wallet: user.wallets && user.wallets.length > 0 ? user.wallets[0] : null
        },
        process.env.SECRET_JWT_KEY,
        { expiresIn: process.env.TOKEN_EXPIRE || "24h" }
    );
};

const sendTokenResponse = (user, statusCode, res) => {
    const token = generateToken(user);
    const exposeTokenInBody = process.env.EXPOSE_TOKEN_IN_BODY !== "false";
    const options = buildAuthCookieOptions();
    const responsePayload = {
        Welcome: `Bienvenido a ODDSWIN ${user.username}`,
        user: toSafeUserPayload(user)
    };

    if (exposeTokenInBody) {
        responsePayload.token = token;
    }

    res.status(statusCode).cookie('token', token, options).json(responsePayload);
};

const verifyGoogleToken = async (token) => {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
    };
};

const verifyFacebookToken = async (token) => {
    const { data } = await axios.get(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${token}`);
    return {
        id: data.id,
        email: data.email,
        name: data.name,
        picture: data.picture?.data?.url
    };
};

const verifyInstagramToken = async (code) => {
    // Exchange code for token
    const params = new URLSearchParams();
    params.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
    params.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', process.env.INSTAGRAM_REDIRECT_URI); // Debe coincidir con frontend
    params.append('code', code);

    const { data: tokenData } = await axios.post('https://api.instagram.com/oauth/access_token', params);

    // Get user info
    const { data: userData } = await axios.get(`https://graph.instagram.com/me?fields=id,username,account_type&access_token=${tokenData.access_token}`);

    // Instagram Basic Display API NO devuelve email
    return {
        id: userData.id,
        name: userData.username, // Instagram usa username como display name principal a veces
        picture: null, // Basic API a veces no da picture facilmente sin permission extra, o se puede intentar otro endpoint. Asumiremos null si falla.
        email: null
    };
};

exports.socialLogin = async (req, res) => {
    try {
        const { provider, token, code, legalAcceptance } = req.body;

        let profile;

        if (provider === 'google') {
            profile = await verifyGoogleToken(token);
        } else if (provider === 'facebook') {
            profile = await verifyFacebookToken(token);
        } else if (provider === 'instagram') {
            // Instagram usa code flow server-side usualmente
            profile = await verifyInstagramToken(code || token);
        } else {
            return res.status(400).json({ error: 'Proveedor no soportado' });
        }

        if (!profile) return res.status(401).json({ error: 'Fallo autenticación con proveedor' });

        // 1. Buscar por Provider
        let user = await User.findOne({
            'providers.id': profile.id,
            'providers.name': provider
        });

        // 2. Si no existe, buscar por Email (si el perfil trae email)
        if (!user && profile.email) {
            user = await User.findOne({ email: profile.email });
        }

        // CASO ESPECIAL: No hay usuario y NO HAY EMAIL (Instagram)
        if (!user && !profile.email) {
            // Generar token temporal firmado para que el frontend pida el email
            const tempToken = jwt.sign(
                {
                    providerData: {
                        id: profile.id,
                        name: profile.name,
                        provider: provider
                    }
                },
                process.env.SECRET_JWT_KEY,
                { expiresIn: '10m' }
            );
            return res.status(200).json({
                status: 'REQUIRE_EMAIL',
                tempToken,
                providerData: { name: profile.name, provider } // Para mostrar en UI
            });
        }

        // LOGIN / REGISTRO
        if (user) {
            const legalResolution = await applyLegalAcceptanceIfRequired({
                user,
                legalAcceptancePayload: legalAcceptance,
                req,
                source: 'social_login'
            });

            if (!legalResolution.ok) {
                return res.status(400).json(buildLegalRequiredErrorPayload(legalResolution));
            }

            // Actualizar Foto (REGLA: Siempre sobrescribir)
            if (profile.picture) {
                user.photo = profile.picture;
            }

            // Vincular si no lo estaba
            const isLinked = user.providers.some(p => p.id === profile.id && p.name === provider);
            if (!isLinked) {
                user.providers.push({ name: provider, id: profile.id });
            }

            await user.save();
            sendTokenResponse(user, 200, res);

        } else {
            const legalValidation = await ensureNewUserLegalAcceptance({
                legalAcceptancePayload: legalAcceptance
            });
            if (!legalValidation.ok) {
                return res.status(400).json(buildLegalRequiredErrorPayload(legalValidation));
            }

            // Crear nuevo usuario
            const newUser = new User({
                username: profile.name || `User${Date.now()}`,
                email: profile.email,
                photo: profile.picture || "",
                providers: [{ name: provider, id: profile.id }],
                isLoggedIn: true,
                isVerified: true // Social login implies verification
            });
            await newUser.save();
            await registerCurrentLegalAcceptanceForNewUser({
                userId: newUser._id,
                req,
                source: "social_login"
            });
            sendTokenResponse(newUser, 201, res);
        }

    } catch (error) {
        console.error("Social Login Error:", error);
        res.status(500).json({ error: "Error en autenticación social", details: error.message });
    }
};

exports.completeSocialLogin = async (req, res) => {
    try {
        const { email, tempToken, legalAcceptance } = req.body;

        // Verificar token temporal
        let decoded;
        try {
            decoded = jwt.verify(tempToken, process.env.SECRET_JWT_KEY);
        } catch (e) {
            return res.status(401).json({ error: 'Token temporal inválido o expirado' });
        }

        const { providerData } = decoded;
        if (!providerData) return res.status(400).json({ error: 'Datos de proveedor inválidos' });

        // Verificar si email existe
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            // REGLA: Si existe, pedir password para vincular manual (Seguridad)
            // O, si queremos simplificar, podriamos retornar un error especifico 'EMAIL_EXISTS_LINK_REQUIRED'
            // El plan dice: "Responder solicitando autenticación tradicional"
            return res.status(409).json({
                error: 'El email ya está registrado',
                code: 'EMAIL_EXISTS',
                message: 'Por favor inicia sesión con tu contraseña y vincula la cuenta desde tu perfil, o confirma tu contraseña ahora.'
                // Aquí el frontend podria pedir password y llamar a otro endpoint de "linkAccount", 
                // pero para simplificar segun plan, "Responder solicitando autenticación tradicional" 
                // sugiere que el usuario aborte este flujo y haga login normal.
                // PERO, el usuario querría loguearse con Instagram la próxima vez.
                // Idealmente: Frontend pide password -> llama a `linkSocialAccount`
            });
        }

        // Crear usuario nuevo con el email proporcionado
        const legalValidation = await ensureNewUserLegalAcceptance({
            legalAcceptancePayload: legalAcceptance
        });
        if (!legalValidation.ok) {
            return res.status(400).json(buildLegalRequiredErrorPayload(legalValidation));
        }

        const newUser = new User({
            username: providerData.name || `User${Date.now()}`,
            email: email,
            photo: "", // Instagram Basic no dio foto, o se perdió
            providers: [{ name: providerData.provider, id: providerData.id }],
            isLoggedIn: true,
            isVerified: true
        });

        await newUser.save();
        await registerCurrentLegalAcceptanceForNewUser({
            userId: newUser._id,
            req,
            source: "social_login"
        });
        sendTokenResponse(newUser, 201, res);

    } catch (error) {
        console.error("Complete Social Login Error:", error);
        res.status(500).json({ error: "Error al completar registro social" });
    }
};
