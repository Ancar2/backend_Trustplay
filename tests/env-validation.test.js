const test = require("node:test");
const assert = require("node:assert/strict");

const { validateEnv } = require("../config/env");

const baseEnv = {
    PORT: "3001",
    DB_URL: "mongodb://127.0.0.1:27017/trustplay_test",
    SECRET_JWT_KEY: "12345678901234567890123456789012",
    NODE_ENV: "development",
};

const withEnv = (overrides, runner) => {
    const originalEnv = { ...process.env };
    process.env = { ...originalEnv, ...baseEnv, ...overrides };
    try {
        runner();
    } finally {
        process.env = originalEnv;
    }
};

test("validateEnv fails when required variables are missing", () => {
    withEnv({ DB_URL: "" }, () => {
        assert.throws(
            () => validateEnv(),
            /Variables de entorno faltantes: DB_URL/
        );
    });
});

test("validateEnv rejects invalid port", () => {
    withEnv({ PORT: "abc" }, () => {
        assert.throws(
            () => validateEnv(),
            /PORT debe ser un numero entero valido/
        );
    });
});

test("validateEnv rejects weak jwt secret in production", () => {
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "https://app.trustplay.com", SECRET_JWT_KEY: "short-secret" }, () => {
        assert.throws(
            () => validateEnv(),
            /SECRET_JWT_KEY debe tener al menos 32 caracteres/
        );
    });
});

test("validateEnv requires frontend origin in production", () => {
    withEnv(
        {
            NODE_ENV: "production",
            AUTH_SAME_DOMAIN: "false",
            FRONTEND_URL: "",
            FRONTEND_URLS: "",
        },
        () => {
            assert.throws(
                () => validateEnv(),
                /debes definir FRONTEND_URL o FRONTEND_URLS/
            );
        }
    );
});

test("validateEnv rejects invalid AUTH_SAME_DOMAIN value", () => {
    withEnv(
        {
            AUTH_SAME_DOMAIN: "maybe",
        },
        () => {
            assert.throws(
                () => validateEnv(),
                /AUTH_SAME_DOMAIN debe ser true o false/
            );
        }
    );
});

test("validateEnv passes with a valid production configuration", () => {
    withEnv(
        {
            NODE_ENV: "production",
            FRONTEND_URL: "https://app.trustplay.com",
            AUTH_SAME_DOMAIN: "false",
            RATE_LIMIT_MAX: "2000",
        },
        () => {
            assert.doesNotThrow(() => validateEnv());
        }
    );
});
