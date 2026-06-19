const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const {
    buildPrivyBridgeToken,
    buildPrivyJwks,
} = require("../services/wallets/privy.service");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
});

const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" });
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });

const withEnv = (overrides, runner) => {
    const originalEnv = { ...process.env };
    process.env = { ...originalEnv, ...overrides };
    try {
        runner();
    } finally {
        process.env = originalEnv;
    }
};

test("buildPrivyBridgeToken signs with RS256 when an RSA private key is configured", () => {
    withEnv(
        {
            PRIVY_JWT_PRIVATE_KEY: privateKeyPem,
            PRIVY_JWT_PUBLIC_KEY: publicKeyPem,
            PRIVY_JWT_AUDIENCE: "privy-app-id",
            PRIVY_JWT_ISSUER: "https://api.trustplay.app",
            PRIVY_JWT_KEY_ID: "trustplay-test-kid",
        },
        () => {
            const token = buildPrivyBridgeToken({
                user: {
                    _id: "507f191e810c19729de860ea",
                    email: "test@trustplay.app",
                    username: "trustplayer",
                    role: "user",
                },
                primaryWallet: "0x1234567890abcdef1234567890abcdef12345678",
            });

            const decoded = jwt.decode(token, { complete: true });
            assert.equal(decoded.header.alg, "RS256");
            assert.equal(decoded.header.kid, "trustplay-test-kid");

            const verified = jwt.verify(token, publicKeyPem, {
                algorithms: ["RS256"],
                audience: "privy-app-id",
                issuer: "https://api.trustplay.app",
            });

            assert.equal(verified.sub, "507f191e810c19729de860ea");
            assert.equal(verified.custom_metadata.source, "trustplay_privy_bridge");
        }
    );
});

test("buildPrivyJwks exposes a public RSA key in JWKS format", () => {
    withEnv(
        {
            PRIVY_JWT_PRIVATE_KEY: privateKeyPem,
            PRIVY_JWT_PUBLIC_KEY: publicKeyPem,
            PRIVY_JWT_KEY_ID: "trustplay-test-kid",
        },
        () => {
            const jwks = buildPrivyJwks();
            assert.equal(Array.isArray(jwks.keys), true);
            assert.equal(jwks.keys.length, 1);
            assert.equal(jwks.keys[0].alg, "RS256");
            assert.equal(jwks.keys[0].use, "sig");
            assert.equal(jwks.keys[0].kid, "trustplay-test-kid");
            assert.equal(jwks.keys[0].kty, "RSA");
        }
    );
});
