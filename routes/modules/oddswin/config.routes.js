const express = require("express");
const configController = require("../../../controllers/oddswin/config.controller");
const authMiddleware = require("../../../middleware/jwt");
const { validateRequest, validators } = require("../../../middleware/requestValidation");

const router = express.Router();

// Global config (shared by frontend/backend integrations)
router.get("/config", configController.getConfig);
router.put(
    "/config",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.configUpdateBody),
    configController.updateConfig
);

module.exports = router;
