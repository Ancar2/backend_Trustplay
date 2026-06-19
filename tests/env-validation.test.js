const test = require("node:test");
const assert = require("node:assert/strict");

const { validateEnv } = require("../config/env");

const baseEnv = {
    PORT: "3001",
    DB_URL: "mongodb://127.0.0.1:27017/trustplay_test",
    SECRET_JWT_KEY: "12345678901234567890123456789012",
    NODE_ENV: "development",
    EDGE_AUTH_ENABLED: "false",
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

test("validateEnv rejects malformed feature flag values", () => {
    withEnv(
        {
            FEATURE_PRIVY_ENABLED: "maybe",
        },
        () => {
            assert.throws(
                () => validateEnv(),
                /FEATURE_PRIVY_ENABLED debe ser true o false/
            );
        }
    );
});

test("validateEnv accepts balance gate flag", () => {
    withEnv(
        {
            FEATURE_BALANCE_GATE_ENABLED: "true",
        },
        () => {
            assert.doesNotThrow(() => validateEnv());
        }
    );
});

test("validateEnv requires Privy credentials when enabled", () => {
    withEnv(
        {
            FEATURE_PRIVY_ENABLED: "true",
            PRIVY_APP_ID: "",
            PRIVY_APP_SECRET: "",
        },
        () => {
            assert.throws(
                () => validateEnv(),
                /PRIVY_APP_ID es obligatorio cuando FEATURE_PRIVY_ENABLED=true/
            );
        }
    );
});

test("validateEnv rejects malformed Privy RSA material", () => {
    withEnv(
        {
            FEATURE_PRIVY_ENABLED: "true",
            PRIVY_APP_ID: "app_123",
            PRIVY_APP_SECRET: "secret_123",
            PRIVY_JWT_PRIVATE_KEY: "not-a-pem",
        },
        () => {
            assert.throws(
                () => validateEnv(),
                /PRIVY_JWT_PRIVATE_KEY debe contener una clave PEM valida/
            );
        }
    );
});

test("validateEnv accepts sprint 0 feature flag defaults", () => {
    withEnv(
        {
            FEATURE_WALLET_IDENTITY_ENABLED: "false",
            FEATURE_PRIVY_ENABLED: "false",
            FEATURE_EXTERNAL_WALLETS_ENABLED: "true",
            FEATURE_PURCHASE_ORCHESTRATOR_ENABLED: "false",
            FEATURE_OBSERVABILITY_ENABLED: "true",
            REQUEST_LOGGING_ENABLED: "true",
        },
        () => {
            assert.doesNotThrow(() => validateEnv());
        }
    );
});
