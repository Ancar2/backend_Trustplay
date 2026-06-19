const express = require("express");
const authMiddleware = require("../../middleware/jwt");
const paymentsController = require("../../controllers/payments.controller");

const router = express.Router();

router.get("/wallets/:address/balance-check", authMiddleware.verifyToken, paymentsController.balanceCheck);
router.post("/purchase/onramp/checkout", authMiddleware.verifyToken, paymentsController.createOnrampCheckout);
router.get("/purchase/:draftId/readiness", authMiddleware.verifyToken, paymentsController.purchaseReadiness);
router.post("/purchase/draft", authMiddleware.verifyToken, paymentsController.createDraft);
router.post("/purchase/:draftId/prepare", authMiddleware.verifyToken, paymentsController.prepareDraft);
router.get("/purchase/:draftId/status", authMiddleware.verifyToken, paymentsController.getDraftStatus);
router.post("/purchase/:draftId/finalize", authMiddleware.verifyToken, paymentsController.finalizeDraft);

module.exports = router;
