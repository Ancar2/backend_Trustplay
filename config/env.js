const REQUIRED_ENV_VARS = ["PORT", "DB_URL", "SECRET_JWT_KEY"];

const asTrimmed = (value) => (value === undefined || value === null ? "" : String(value).trim());

const asBoolean = (value, fallback = null) => {
    const normalized = asTrimmed(value).toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
};

const validateRequiredVars = () => {
    const missing = REQUIRED_ENV_VARS.filter((key) => asTrimmed(process.env[key]).length === 0);
    if (missing.length > 0) {
        throw new Error(`Variables de entorno faltantes: ${missing.join(", ")}`);
    }
};

const validatePort = () => {
    const port = Number(asTrimmed(process.env.PORT));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT debe ser un numero entero valido entre 1 y 65535.");
    }
};

const validateJwtSecret = (isProduction) => {
    const secret = asTrimmed(process.env.SECRET_JWT_KEY);
    const minLength = isProduction ? 32 : 8;
    if (secret.length < minLength) {
        throw new Error(`SECRET_JWT_KEY debe tener al menos ${minLength} caracteres.`);
    }
};

const validateSameDomainFlag = () => {
    const sameDomain = asTrimmed(process.env.AUTH_SAME_DOMAIN);
    if (!sameDomain) return;

    const parsed = asBoolean(sameDomain, null);
    if (parsed === null) {
        throw new Error("AUTH_SAME_DOMAIN debe ser true o false.");
    }
};

const validateCorsConfig = (isProduction) => {
    if (!isProduction) return;

    const sameDomain = asBoolean(process.env.AUTH_SAME_DOMAIN, true);
    const frontendUrl = asTrimmed(process.env.FRONTEND_URL);
    const frontendUrls = asTrimmed(process.env.FRONTEND_URLS);
    if (sameDomain === false && !frontendUrl && !frontendUrls) {
        throw new Error("En produccion con AUTH_SAME_DOMAIN=false debes definir FRONTEND_URL o FRONTEND_URLS para CORS.");
    }
};

const validateRateLimitConfig = () => {
    const max = asTrimmed(process.env.RATE_LIMIT_MAX);
    if (!max) return;

    const parsed = Number(max);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("RATE_LIMIT_MAX debe ser un numero positivo.");
    }
};

const validateFeatureFlagsConfig = () => {
    const flagNames = [
        "FEATURE_WALLET_IDENTITY_ENABLED",
        "FEATURE_PRIVY_ENABLED",
        "FEATURE_EXTERNAL_WALLETS_ENABLED",
        "FEATURE_BALANCE_GATE_ENABLED",
        "FEATURE_PURCHASE_ORCHESTRATOR_ENABLED",
        "FEATURE_OBSERVABILITY_ENABLED",
        "REQUEST_LOGGING_ENABLED",
    ];

    flagNames.forEach((name) => {
        const rawValue = asTrimmed(process.env[name]);
        if (!rawValue) return;
        const parsed = asBoolean(rawValue, null);
        if (parsed === null) {
            throw new Error(`${name} debe ser true o false.`);
        }
    });

    const privyEnabled = asBoolean(process.env.FEATURE_PRIVY_ENABLED, false);
    if (privyEnabled) {
        if (!asTrimmed(process.env.PRIVY_APP_ID)) {
            throw new Error("PRIVY_APP_ID es obligatorio cuando FEATURE_PRIVY_ENABLED=true.");
        }
        if (!asTrimmed(process.env.PRIVY_APP_SECRET)) {
            throw new Error("PRIVY_APP_SECRET es obligatorio cuando FEATURE_PRIVY_ENABLED=true.");
        }

        const privateKey = asTrimmed(process.env.PRIVY_JWT_PRIVATE_KEY).replace(/\\n/g, "\n");
        const publicKey = asTrimmed(process.env.PRIVY_JWT_PUBLIC_KEY).replace(/\\n/g, "\n");
        const publicCertificate = asTrimmed(process.env.PRIVY_JWT_PUBLIC_CERTIFICATE).replace(/\\n/g, "\n");

        if (privateKey && !privateKey.includes("BEGIN")) {
            throw new Error("PRIVY_JWT_PRIVATE_KEY debe contener una clave PEM valida.");
        }
        if (publicKey && !publicKey.includes("BEGIN")) {
            throw new Error("PRIVY_JWT_PUBLIC_KEY debe contener una clave PEM valida.");
        }
        if (publicCertificate && !publicCertificate.includes("BEGIN CERTIFICATE")) {
            throw new Error("PRIVY_JWT_PUBLIC_CERTIFICATE debe contener un certificado X.509 valido.");
        }
    }

};

const validateEdgeGuardConfig = (isProduction) => {
    const edgeAuthEnabled = isProduction
        ? asBoolean(process.env.EDGE_AUTH_ENABLED, true)
        : asBoolean(process.env.EDGE_AUTH_ENABLED, false);

    if (!edgeAuthEnabled) return;

    const headerName = asTrimmed(process.env.EDGE_SHARED_HEADER || "x-trustplay-edge-key");
    if (!headerName) {
        throw new Error("EDGE_SHARED_HEADER no puede estar vacío cuando EDGE_AUTH_ENABLED=true.");
    }

    const secret = asTrimmed(process.env.EDGE_SHARED_SECRET);
    if (!secret) {
        throw new Error("EDGE_SHARED_SECRET es obligatorio cuando EDGE_AUTH_ENABLED=true.");
    }
};

const validateEnv = () => {
    const isProduction = asTrimmed(process.env.NODE_ENV).toLowerCase() === "production";

    validateRequiredVars();
    validatePort();
    validateJwtSecret(isProduction);
    validateRateLimitConfig();
    validateFeatureFlagsConfig();
    validateCorsConfig(isProduction);
    validateSameDomainFlag();
    validateEdgeGuardConfig(isProduction);
};

module.exports = {
    validateEnv,
};
