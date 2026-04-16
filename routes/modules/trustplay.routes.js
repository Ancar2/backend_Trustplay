const express = require("express");
const rateLimit = require("express-rate-limit");
const trustplayInfoController = require("../../controllers/trustplay/trustplayInfo.controller");
const trustplayAssistantController = require("../../controllers/trustplay/trustplayAssistant.controller");
const legalAcceptanceController = require("../../controllers/trustplay/legalAcceptance.controller");
const authMiddleware = require("../../middleware/jwt");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

const trustplayAssistantLimiter = rateLimit({
    windowMs: Number(process.env.GEMINI_CHAT_RATE_LIMIT_WINDOW_MS || 900000), // Default 15 min
    max: Number(process.env.GEMINI_CHAT_RATE_LIMIT_MAX || 20), // Default 20 messages
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        ok: false,
        msg: "Has alcanzado el límite de mensajes permitidos. Por favor, intenta de nuevo en unos minutos.",
        code: "rate_limit_exceeded"
    }
});

router.get("/trustplay-info", trustplayInfoController.getInfo);
router.get("/trustplay/share/:slug", trustplayInfoController.openShareRoomPage);
router.post(
    "/trustplay/assistant/chat",
    trustplayAssistantLimiter,
    validateRequest(validators.trustplayAssistantBody),
    trustplayAssistantController.chat
);
router.put(
    "/trustplay-info",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayUpdateBody),
    trustplayInfoController.updateInfo
);
router.put(
    "/trustplay-info/user-guide",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.trustplayUserGuideBody),
    trustplayInfoController.uploadUserGuide
);
router.delete(
    "/trustplay-info/user-guide",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    trustplayInfoController.deleteUserGuide
);
router.get(
    "/trustplay-info/user-guide/download",
    trustplayInfoController.downloadUserGuide
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
