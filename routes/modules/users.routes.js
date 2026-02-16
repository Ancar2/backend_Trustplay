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

module.exports = router;
