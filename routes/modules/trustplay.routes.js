const express = require("express");
const trustplayInfoController = require("../../controllers/trustplay/trustplayInfo.controller");
const legalAcceptanceController = require("../../controllers/trustplay/legalAcceptance.controller");
const authMiddleware = require("../../middleware/jwt");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

router.get("/trustplay-info", trustplayInfoController.getInfo);
router.put(
    "/trustplay-info",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayUpdateBody),
    trustplayInfoController.updateInfo
);

router.get(
    "/legal/acceptance-audit",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    legalAcceptanceController.getAcceptanceAudit
);

module.exports = router;
