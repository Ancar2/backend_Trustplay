#!/usr/bin/env node

require("dotenv").config();

const { validateEnv } = require("../config/env");

const failures = [];
const warnings = [];
const notes = [];

const asTrimmed = (value) => (value === undefined || value === null ? "" : String(value).trim());
const asBoolean = (value, fallback = null) => {
    const normalized = asTrimmed(value).toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
};

const isHttpsUrl = (value) => {
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
};

const parseOrigins = () => {
    return [
        asTrimmed(process.env.FRONTEND_URL),
        ...asTrimmed(process.env.FRONTEND_URLS).split(",").map((item) => item.trim()).filter(Boolean),
    ].filter(Boolean);
};

const isProduction = asTrimmed(process.env.NODE_ENV).toLowerCase() === "production";

try {
    validateEnv();
    notes.push("validateEnv: OK");
} catch (error) {
    failures.push(`validateEnv: ${error.message}`);
}

const jwtSecretLength = asTrimmed(process.env.SECRET_JWT_KEY).length;
if (jwtSecretLength < 32) {
    warnings.push("SECRET_JWT_KEY tiene menos de 32 caracteres. Recomendado aumentar para mayor seguridad.");
}

const exposeTokenInBody = asTrimmed(process.env.EXPOSE_TOKEN_IN_BODY).toLowerCase();
if (isProduction && exposeTokenInBody !== "false") {
    failures.push("EXPOSE_TOKEN_IN_BODY debe ser false en produccion.");
}

const origins = parseOrigins();
if (isProduction) {
    if (origins.length === 0) {
        failures.push("No hay origenes frontend configurados (FRONTEND_URL/FRONTEND_URLS).");
    }
    const nonHttpsOrigins = origins.filter((origin) => !isHttpsUrl(origin));
    if (nonHttpsOrigins.length > 0) {
        failures.push(`En produccion todos los origenes frontend deben ser HTTPS. Invalidos: ${nonHttpsOrigins.join(", ")}`);
    }
}

const cookieSecure = asBoolean(process.env.AUTH_COOKIE_SECURE, null);
if (isProduction && cookieSecure !== true) {
    failures.push("AUTH_COOKIE_SECURE debe ser true en produccion.");
}

const authRateLimit = Number(asTrimmed(process.env.AUTH_RATE_LIMIT_MAX) || "0");
const globalRateLimit = Number(asTrimmed(process.env.RATE_LIMIT_MAX) || "0");
if (authRateLimit > 0 && globalRateLimit > 0 && authRateLimit > globalRateLimit) {
    warnings.push("AUTH_RATE_LIMIT_MAX es mayor que RATE_LIMIT_MAX. Revisa los limites para evitar configuracion inconsistente.");
}

const smtpEmail = asTrimmed(process.env.SMTP_EMAIL);
const smtpPassword = asTrimmed(process.env.SMTP_PASSWORD);
if ((smtpEmail && !smtpPassword) || (!smtpEmail && smtpPassword)) {
    failures.push("SMTP_EMAIL y SMTP_PASSWORD deben estar definidos juntos.");
}
if (!smtpEmail && !smtpPassword) {
    warnings.push("SMTP no configurado. Registro/verificacion de correo no funcionara.");
}

const googleClientId = asTrimmed(process.env.GOOGLE_CLIENT_ID);
if (!googleClientId) {
    warnings.push("GOOGLE_CLIENT_ID no esta configurado. Login social Google no estara disponible.");
}

console.log("=== Security Baseline Check (api_Trustplay) ===");
notes.forEach((item) => console.log(`OK: ${item}`));
warnings.forEach((item) => console.log(`WARN: ${item}`));
failures.forEach((item) => console.log(`FAIL: ${item}`));

if (failures.length > 0) {
    console.error(`\nResultado: FALLA (${failures.length} hallazgos criticos).`);
    process.exit(1);
}

console.log(`\nResultado: OK con ${warnings.length} advertencias.`);
process.exit(0);
