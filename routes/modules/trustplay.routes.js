const express = require("express");
const trustplayInfoController = require("../../controllers/trustplay/trustplayInfo.controller");
const legalAcceptanceController = require("../../controllers/trustplay/legalAcceptance.controller");
const authMiddleware = require("../../middleware/jwt");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

router.get("/trustplay-info", trustplayInfoController.getInfo);
router.get("/trustplay/share/:slug", trustplayInfoController.openShareRoomPage);
router.put(
    "/trustplay-info",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayUpdateBody),
    trustplayInfoController.updateInfo
);
router.get(
    "/trustplay-info/share-rooms",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    trustplayInfoController.listShareRooms
);
router.post(
    "/trustplay-info/share-rooms",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayShareRoomBody),
    trustplayInfoController.createShareRoom
);
router.put(
    "/trustplay-info/share-rooms/:id",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayShareRoomBody),
    trustplayInfoController.updateShareRoom
);
router.delete(
    "/trustplay-info/share-rooms/:id",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    trustplayInfoController.deleteShareRoom
);

router.get(
    "/legal/acceptance-audit",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    legalAcceptanceController.getAcceptanceAudit
);

module.exports = router;
