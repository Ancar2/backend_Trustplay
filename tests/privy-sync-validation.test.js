const test = require("node:test");
const assert = require("node:assert/strict");

const { validators } = require("../middleware/requestValidation");

test("walletPrivySyncBody accepts a valid payload", () => {
    const errors = validators.walletPrivySyncBody({
        body: {
            walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
            privyWalletId: "wallet-123",
            walletType: "embedded",
            provider: "privy",
        },
    });

    assert.deepEqual(errors, []);
});

test("walletPrivySyncBody rejects invalid provider and wallet type", () => {
    const errors = validators.walletPrivySyncBody({
        body: {
            walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
            privyWalletId: 123,
            walletType: "external",
            provider: "metamask",
        },
    });

    assert.ok(errors.includes("privyWalletId debe ser string."));
    assert.ok(errors.includes("walletType no es válido."));
    assert.ok(errors.includes("provider no es válido."));
});
