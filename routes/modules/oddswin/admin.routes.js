const express = require("express");
const adminController = require("../../../controllers/oddswin/admin.controller");
const reconcileController = require("../../../controllers/oddswin/reconcile.controller");
const authMiddleware = require("../../../middleware/jwt");
const { validateRequest, validators } = require("../../../middleware/requestValidation");

const router = express.Router();

router.get(
    "/users/stats",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    adminController.getUserStats
);

router.get(
    "/users/all",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    adminController.getAllUsers
);

router.get(
    "/users/sponsor-stats/:walletAddress",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    adminController.getSponsorStats
);

router.get(
    "/oddswin/reconcile/status",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    reconcileController.getReconcileStatus
);

router.get(
    "/oddswin/reconcile/lotteries/options",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    reconcileController.getReconcileLotteriesOptions
);

router.post(
    "/oddswin/reconcile",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.reconcileBody),
    reconcileController.runReconcile
);

router.post(
    "/oddswin/reconcile/lotteries-sync",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.reconcileLotteriesBody),
    reconcileController.syncLotteries
);

router.post(
    "/oddswin/reconcile/stop",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    reconcileController.stopReconcile
);

module.exports = router;
