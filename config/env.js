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

const validateEnv = () => {
    const isProduction = asTrimmed(process.env.NODE_ENV).toLowerCase() === "production";

    validateRequiredVars();
    validatePort();
    validateJwtSecret(isProduction);
    validateRateLimitConfig();
    validateCorsConfig(isProduction);
    validateSameDomainFlag();
};

module.exports = {
    validateEnv,
};
