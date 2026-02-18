const express = require("express");

const legalController = require("../../controllers/legal/legal.controller");
const authMiddleware = require("../../middleware/jwt");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

router.get("/legal/documents", legalController.getDocuments);
router.get("/legal/documents/:key", legalController.getDocumentByKey);
router.post(
    "/legal/accept",
    authMiddleware.verifyToken,
    validateRequest(validators.legalAcceptBody),
    legalController.acceptDocument
);

router.get(
    "/legal/documents/:key/versions",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    legalController.getDocumentVersions
);

router.post(
    "/legal/documents/:key/versions",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.legalCreateVersionBody),
    legalController.createDocumentVersion
);

router.put(
    "/legal/documents/:key/versions/:versionId/publish",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    legalController.publishDocumentVersion
);

module.exports = router;
