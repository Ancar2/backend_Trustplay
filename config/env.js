const REQUIRED_ENV_VARS = [
    "PORT",
    "DB_URL",
    "SECRET_JWT_KEY"
];

const validateEnv = () => {
    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || String(process.env[key]).trim().length === 0);

    if (missing.length > 0) {
        throw new Error(`Variables de entorno faltantes: ${missing.join(", ")}`);
    }
};

module.exports = {
    validateEnv
};
