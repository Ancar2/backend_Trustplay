const test = require("node:test");
const assert = require("node:assert/strict");

const {
    parseBoolean,
    parseCsv,
    parseNumber,
    resolveRuntimeConfig,
} = require("../services/system/featureFlags.service");

test("parseBoolean understands common truthy and falsy values", () => {
    assert.equal(parseBoolean("true"), true);
    assert.equal(parseBoolean("1"), true);
    assert.equal(parseBoolean("yes"), true);
    assert.equal(parseBoolean("false"), false);
    assert.equal(parseBoolean("0"), false);
    assert.equal(parseBoolean("no", false), false);
});

test("parseCsv trims and removes empty items", () => {
    assert.deepEqual(parseCsv("usdt, pol, , cop "), ["usdt", "pol", "cop"]);
});

test("parseNumber falls back when value is invalid", () => {
    assert.equal(parseNumber("abc", 3), 3);
    assert.equal(parseNumber("5", 3), 5);
});

test("resolveRuntimeConfig exposes sprint 0 defaults", () => {
    const originalEnv = { ...process.env };
    process.env = {
        ...originalEnv,
        FEATURE_EXTERNAL_WALLETS_ENABLED: "true",
        FEATURE_OBSERVABILITY_ENABLED: "true",
        FEATURE_PRIVY_ENABLED: "false",
        FEATURE_BALANCE_GATE_ENABLED: "false",
        MIN_POL_BALANCE: "3",
    };

    try {
        const config = resolveRuntimeConfig();
        assert.equal(config.featureFlags.externalWalletsEnabled, true);
        assert.equal(config.featureFlags.privyEmbeddedWalletsEnabled, false);
        assert.equal(config.featureFlags.balanceGateEnabled, false);
        assert.equal(config.purchase.minPolBalance, 3);
        assert.equal(config.observability.requestLoggingEnabled, true);
    } finally {
        process.env = originalEnv;
    }
});
