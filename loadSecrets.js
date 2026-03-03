const { TextDecoder } = require("node:util");
const dotenv = require("dotenv");
const {
    SecretsManagerClient,
    GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const TRUE_VALUES = new Set(["true", "1", "yes", "si", "on"]);
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/i;

class SecretsLoadingError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "SecretsLoadingError";
        if (options.cause) {
            this.cause = options.cause;
        }
    }
}

const normalizeString = (value) => String(value ?? "").trim();

const parseBoolean = (value, fallback = false) => {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return fallback;
    return TRUE_VALUES.has(normalized);
};

const loadLocalEnvFile = ({ dotenvPath, runtimeEnv }) => {
    // Se carga primero .env local para permitir flags de arranque como el id del secreto y la región.
    dotenv.config({
        ...(dotenvPath ? { path: dotenvPath } : {}),
        processEnv: runtimeEnv,
    });
};

const resolveSecretsConfig = (runtimeEnv) => {
    const enabled = parseBoolean(runtimeEnv.AWS_SECRETS_ENABLED, false);
    const secretId = normalizeString(
        runtimeEnv.AWS_SECRETS_ID
        || runtimeEnv.AWS_SECRET_ID
        || runtimeEnv.SECRETS_MANAGER_SECRET_ID
    );
    const region = normalizeString(
        runtimeEnv.AWS_SECRETS_REGION
        || runtimeEnv.AWS_REGION
        || runtimeEnv.AWS_DEFAULT_REGION
    );
    const overrideExisting = parseBoolean(runtimeEnv.AWS_SECRETS_OVERRIDE_LOCAL, true);

    return {
        enabled,
        secretId,
        region,
        overrideExisting,
    };
};

const validateSecretsConfig = (config) => {
    const isProduction = normalizeString(process.env.NODE_ENV).toLowerCase() === "production";

    if (!config.enabled) {
        if (isProduction) {
            throw new SecretsLoadingError(
                "En entornos de produccion, la carga de configuración debe depender exclusivamente de fuentes externas seguras"
            );
        }
        return;
    }

    if (!config.secretId) {
        throw new SecretsLoadingError(
            "AWS_SECRETS_ENABLED=true pero no se configuró AWS_SECRETS_ID/AWS_SECRET_ID."
        );
    }

    if (!config.region) {
        throw new SecretsLoadingError(
            "AWS_SECRETS_ENABLED=true pero no se configuró AWS_SECRETS_REGION/AWS_REGION."
        );
    }
};

const createSecretsManagerClient = (region) => {
    // El SDK usa la cadena estándar de credenciales de AWS, compatible con IAM Role en EC2.
    return new SecretsManagerClient({ region });
};

const decodeSecretBinary = (secretBinary) => {
    if (!secretBinary) return "";

    if (secretBinary instanceof Uint8Array) {
        return new TextDecoder("utf-8").decode(secretBinary);
    }

    if (Buffer.isBuffer(secretBinary)) {
        return secretBinary.toString("utf-8");
    }

    return "";
};

const extractSecretPayload = (secretValue, secretId) => {
    const secretString = normalizeString(secretValue?.SecretString);
    if (secretString) {
        return secretString;
    }

    const secretBinary = decodeSecretBinary(secretValue?.SecretBinary);
    if (normalizeString(secretBinary)) {
        return secretBinary;
    }

    throw new SecretsLoadingError(
        `El secreto "${secretId}" no contiene SecretString ni SecretBinary con contenido utilizable.`
    );
};

const parseSecretJson = (secretPayload, secretId) => {
    let parsed;

    try {
        parsed = JSON.parse(secretPayload);
    } catch (error) {
        throw new SecretsLoadingError(
            `El secreto "${secretId}" no contiene un JSON válido.`,
            { cause: error }
        );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SecretsLoadingError(
            `El secreto "${secretId}" debe ser un objeto JSON plano con variables de entorno.`
        );
    }

    return parsed;
};

const normalizeSecretEntries = (secretObject, secretId) => {
    const normalizedEntries = {};

    Object.entries(secretObject).forEach(([rawKey, rawValue]) => {
        const key = normalizeString(rawKey);

        if (!key) {
            throw new SecretsLoadingError(
                `El secreto "${secretId}" contiene una clave vacía.`
            );
        }

        if (!ENV_KEY_PATTERN.test(key)) {
            throw new SecretsLoadingError(
                `La clave "${key}" del secreto "${secretId}" no es un nombre válido de variable de entorno.`
            );
        }

        normalizedEntries[key] = rawValue == null
            ? ""
            : (typeof rawValue === "object"
                ? JSON.stringify(rawValue)
                : String(rawValue));
    });

    return normalizedEntries;
};

const applySecretEntriesToEnv = (entries, { targetEnv, overrideExisting }) => {
    const appliedKeys = [];

    Object.entries(entries).forEach(([key, value]) => {
        if (!overrideExisting && typeof targetEnv[key] !== "undefined") {
            return;
        }

        targetEnv[key] = value;
        appliedKeys.push(key);
    });

    return appliedKeys;
};

const getSecretValue = async ({ client, secretId }) => {
    try {
        return await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    } catch (error) {
        throw new SecretsLoadingError(
            `No se pudo obtener el secreto "${secretId}" desde AWS Secrets Manager.`,
            { cause: error }
        );
    }
};

const loadSecrets = async ({
    runtimeEnv = process.env,
    targetEnv = process.env,
    dotenvPath,
    secretsClient,
} = {}) => {
    loadLocalEnvFile({ dotenvPath, runtimeEnv });

    const config = resolveSecretsConfig(runtimeEnv);
    validateSecretsConfig(config);

    if (!config.enabled) {
        return {
            loaded: false,
            source: "dotenv",
            secretId: null,
            region: null,
            appliedKeys: [],
        };
    }

    const client = secretsClient || createSecretsManagerClient(config.region);
    const secretValue = await getSecretValue({
        client,
        secretId: config.secretId,
    });
    const secretPayload = extractSecretPayload(secretValue, config.secretId);
    const secretObject = parseSecretJson(secretPayload, config.secretId);
    const normalizedEntries = normalizeSecretEntries(secretObject, config.secretId);
    const appliedKeys = applySecretEntriesToEnv(normalizedEntries, {
        targetEnv,
        overrideExisting: config.overrideExisting,
    });

    return {
        loaded: true,
        source: "aws-secrets-manager",
        secretId: config.secretId,
        region: config.region,
        appliedKeys,
    };
};

module.exports = {
    SecretsLoadingError,
    applySecretEntriesToEnv,
    createSecretsManagerClient,
    extractSecretPayload,
    getSecretValue,
    loadLocalEnvFile,
    loadSecrets,
    normalizeSecretEntries,
    parseSecretJson,
    resolveSecretsConfig,
};
