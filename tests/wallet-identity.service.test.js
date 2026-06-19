const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CHALLENGE_TTL_MS,
    buildChallengeMessage,
    createChallengeEnvelope,
    identityToPayload,
    normalizeWalletAddress,
    normalizeWalletProvider,
    normalizeWalletType,
} = require("../services/wallets/walletIdentity.service");

test("normalizeWalletAddress trims and lowercases values", () => {
    assert.equal(normalizeWalletAddress(" 0xAbC123 "), "0xabc123");
});

test("normalizeWalletProvider maps common providers to canonical values", () => {
    assert.equal(normalizeWalletProvider("Trust Wallet"), "trustwallet");
    assert.equal(normalizeWalletProvider("wallet connect"), "walletconnect");
    assert.equal(normalizeWalletProvider("MetaMask"), "metamask");
    assert.equal(normalizeWalletProvider("unknown"), "legacy");
});

test("normalizeWalletType defaults to external", () => {
    assert.equal(normalizeWalletType("embedded"), "embedded");
    assert.equal(normalizeWalletType("anything-else"), "external");
});

test("challenge envelope contains nonce, expiry and normalized address", () => {
    const challenge = createChallengeEnvelope({
        userId: "user-1",
        walletAddress: "0xAbC123",
    });

    assert.ok(challenge.nonce);
    assert.ok(challenge.message.includes("Wallet: 0xabc123"));
    assert.ok(challenge.message.includes("Purpose: wallet-link"));
    assert.equal(
        new Date(challenge.expiresAt).getTime() - new Date(challenge.issuedAt).getTime(),
        CHALLENGE_TTL_MS
    );
});

test("identityToPayload exposes safe identity fields", () => {
    const payload = identityToPayload({
        _id: "wallet-id",
        userId: "user-id",
        address: "0xabc123",
        provider: "legacy",
        walletType: "external",
        isPrimary: true,
        isVerified: true,
        linkedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastUsedAt: null,
        status: "active",
        metadata: { source: "test" },
        challengeExpiresAt: null,
        challengeIssuedAt: null,
    });

    assert.deepEqual(payload, {
        id: "wallet-id",
        userId: "user-id",
        address: "0xabc123",
        provider: "legacy",
        walletType: "external",
        isPrimary: true,
        isVerified: true,
        linkedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastUsedAt: null,
        status: "active",
        metadata: { source: "test" },
        challengeExpiresAt: null,
        challengeIssuedAt: null,
    });
});
