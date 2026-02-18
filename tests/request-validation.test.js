const test = require("node:test");
const assert = require("node:assert/strict");
const { validators } = require("../middleware/requestValidation");

test("register validator rejects missing required fields", () => {
    const req = { body: {} };
    const errors = validators.registerBody(req);
    assert.ok(errors.length >= 3);
});

test("login validator accepts valid payload", () => {
    const req = { body: { email: "user@test.com", password: "StrongPass1!" } };
    const errors = validators.loginBody(req);
    assert.equal(errors.length, 0);
});

test("resend verification validator requires email", () => {
    const req = { body: {} };
    const errors = validators.resendVerificationBody(req);
    assert.ok(errors.includes("email es requerido."));
});

test("claim validator rejects negative amount", () => {
    const req = {
        body: {
            tokenId: 1,
            owner: "0xabc",
            amount: -1
        }
    };
    const errors = validators.claimRecordBody(req);
    assert.ok(errors.includes("amount no puede ser negativo."));
});

test("close lottery validator accepts numeric-like finalPool", () => {
    const req = {
        body: {
            finalPool: "100.50",
            winningNumber: "123"
        }
    };
    const errors = validators.closeLotteryBody(req);
    assert.equal(errors.length, 0);
});

test("close lottery validator accepts valid txHash", () => {
    const req = {
        body: {
            txHash: "0x0f9a2a9a140648366e1f5bb8ef93de572627a44d0a5038cf5c58104a5e966536"
        }
    };
    const errors = validators.closeLotteryBody(req);
    assert.equal(errors.length, 0);
});

test("close lottery validator rejects invalid txHash", () => {
    const req = {
        body: {
            txHash: "0x123"
        }
    };
    const errors = validators.closeLotteryBody(req);
    assert.ok(errors.includes("txHash debe ser un hash válido de transacción."));
});

test("lottery event schedule validator rejects missing scheduledAt", () => {
    const req = { body: {} };
    const errors = validators.lotteryEventScheduleBody(req);
    assert.ok(errors.includes("scheduledAt es requerido."));
});

test("lottery event schedule validator accepts ISO date", () => {
    const req = { body: { scheduledAt: "2026-03-20T23:00:00-05:00" } };
    const errors = validators.lotteryEventScheduleBody(req);
    assert.equal(errors.length, 0);
});

test("lottery result video validator rejects missing videoUrl", () => {
    const req = { body: {} };
    const errors = validators.lotteryResultVideoBody(req);
    assert.ok(errors.includes("videoUrl es requerido."));
});

test("lottery result video validator accepts url and title", () => {
    const req = {
        body: {
            videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            videoTitle: "Resultado oficial"
        }
    };
    const errors = validators.lotteryResultVideoBody(req);
    assert.equal(errors.length, 0);
});

test("reconcile validator rejects range invertido", () => {
    const req = {
        body: {
            fromBlock: 200,
            toBlock: 100
        }
    };
    const errors = validators.reconcileBody(req);
    assert.ok(errors.includes("fromBlock no puede ser mayor que toBlock."));
});

test("reconcile validator rejects year range invertido", () => {
    const req = {
        body: {
            yearStart: 2027,
            yearEnd: 2021
        }
    };
    const errors = validators.reconcileBody(req);
    assert.ok(errors.includes("yearStart no puede ser mayor que yearEnd."));
});

test("reconcile validator rejects invalid lotteryAddress", () => {
    const req = {
        body: {
            lotteryAddress: "0x123"
        }
    };
    const errors = validators.reconcileBody(req);
    assert.ok(errors.includes("lotteryAddress debe ser una direccion valida."));
});

test("reconcile lotteries validator accepts empty body", () => {
    const req = { body: {} };
    const errors = validators.reconcileLotteriesBody(req);
    assert.equal(errors.length, 0);
});

test("reconcile lotteries validator rejects year range invertido", () => {
    const req = {
        body: {
            yearStart: 2027,
            yearEnd: 2021
        }
    };
    const errors = validators.reconcileLotteriesBody(req);
    assert.ok(errors.includes("yearStart no puede ser mayor que yearEnd."));
});

test("legal accept validator accepts valid payload", () => {
    const req = {
        body: {
            documentKey: "terms",
            versionId: "507f1f77bcf86cd799439011",
            source: "legal_center"
        }
    };
    const errors = validators.legalAcceptBody(req);
    assert.equal(errors.length, 0);
});

test("legal create version validator requires content", () => {
    const req = {
        body: {
            version: "1.2.0"
        }
    };
    const errors = validators.legalCreateVersionBody(req);
    assert.ok(errors.includes("Debes enviar contentUrl o contentHtml."));
});
