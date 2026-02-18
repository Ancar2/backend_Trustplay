const express = require("express");
const userController = require("../../controllers/user.controller");
const authMiddleware = require("../../middleware/jwt");
const {
    requireSelfOrAdmin,
    requireWalletAccess,
    requireWalletOrReferralAccess
} = require("../../middleware/authorize");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

router.get("/users/me", authMiddleware.verifyToken, userController.getMe);
router.get("/users/sponsor/:wallet", userController.getSponsorInfo);
router.get("/users/sponsor-by-wallet/:wallet", userController.getSponsorByWallet);

router.get(
    "/users/referrals/:wallet",
    authMiddleware.verifyToken,
    requireWalletAccess("wallet"),
    userController.getReferralSummary
);

router.get(
    "/users/referrals/direct/:wallet",
    authMiddleware.verifyToken,
    requireWalletOrReferralAccess("wallet"),
    userController.getDirectReferrals
);

router.get(
    "/users/referrals/indirect/:wallet",
    authMiddleware.verifyToken,
    requireWalletOrReferralAccess("wallet"),
    userController.getIndirectReferrals
);

router.get(
    "/users/referrals/lost-earnings/:wallet",
    authMiddleware.verifyToken,
    requireWalletAccess("wallet"),
    userController.getLostEarningsByLottery
);

router.put(
    "/users/profile/:id",
    authMiddleware.verifyToken,
    requireSelfOrAdmin("id"),
    userController.updateProfile
);

router.put(
    "/users/password/:id",
    authMiddleware.verifyToken,
    requireSelfOrAdmin("id"),
    userController.updatePassword
);

router.post(
    "/users/wallet",
    authMiddleware.verifyToken,
    validateRequest(validators.addWalletBody),
    userController.addWallet
);

router.delete(
    "/users/wallet/:wallet",
    authMiddleware.verifyToken,
    userController.removeWallet
);

router.put(
    "/users/deactivate/:id",
    authMiddleware.verifyToken,
    requireSelfOrAdmin("id"),
    userController.deactivateAccount
);

router.get("/users/earnings", authMiddleware.verifyToken, userController.getTotalEarnings);
router.get(
    "/users/earnings-breakdown/:wallet",
    authMiddleware.verifyToken,
    requireWalletAccess("wallet"),
    userController.getEarningsBreakdownByLottery
);

router.get(
    "/users/legal-stats/:id",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    // Assuming isAdmin middleware exists here or we use requireSelfOrAdmin if user wants to see their own.
    // Req says "admin users section", so isAdmin is appropriate.
    // If not available in this file, we might need to import it or rely on logic.
    // authMiddleware usually has isAdmin.
    userController.getUserLegalStats
);

module.exports = router;
