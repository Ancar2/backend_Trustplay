const express = require("express");
const lotteryController = require("../../../controllers/oddswin/lottery.controller");
const boxController = require("../../../controllers/oddswin/box.controller");
const playerController = require("../../../controllers/oddswin/player.controller");
const sponsorController = require("../../../controllers/oddswin/sponsor.controller");
const exclusiveNftController = require("../../../controllers/oddswin/exclusiveNft.controller");
const authMiddleware = require("../../../middleware/jwt");
const {
    requireSelfOrAdmin,
    requireBodyWalletOwnership
} = require("../../../middleware/authorize");
const { validateRequest, validators } = require("../../../middleware/requestValidation");

const router = express.Router();

// --- Lotteries ---
router.post(
    "/lotteries",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.createLotteryBody),
    lotteryController.createLottery
);
router.get("/lottery/next-live", lotteryController.getNextLive);
router.get("/lotteries", lotteryController.getLotteries);
router.get("/lotteries/:address", lotteryController.getLotteryByAddress);
router.put("/lotteries/:address", authMiddleware.verifyToken, authMiddleware.isAdmin, lotteryController.updateLotteryMetadata);
router.put(
    "/lotteries/:address/event-schedule",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.lotteryEventScheduleBody),
    lotteryController.announceLotteryEvent
);

router.post(
    "/lotteries/:address/close",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    validateRequest(validators.closeLotteryBody),
    lotteryController.closeLottery
);
router.get("/lotteries/:address/top-buyers", lotteryController.getTopBuyers);
router.get("/lotteries/:address/top-sponsors", lotteryController.getTopSponsors);

// --- Boxes ---
router.post(
    "/boxes/purchase",
    authMiddleware.verifyToken,
    validateRequest(validators.registerBoxPurchaseBody),
    requireBodyWalletOwnership("owner"),
    boxController.registerBoxPurchase
);
router.get("/boxes/user", authMiddleware.verifyToken, boxController.getUserBoxes);
router.get("/boxes/lottery/:address", boxController.getBoxesByLotteryAddress);

// --- Player (Oddswin) ---
router.post("/player/add-wallet", authMiddleware.verifyToken, playerController.addWallet);
router.get(
    "/player/profile/:id",
    authMiddleware.verifyToken,
    requireSelfOrAdmin("id"),
    playerController.getUserProfile
);
router.get(
    "/player/referrals-activity/:userId",
    authMiddleware.verifyToken,
    requireSelfOrAdmin("userId"),
    sponsorController.getReferralsActivity
);

// --- Exclusive NFT ---
router.get("/exclusive-nft/metadata/:tokenId", exclusiveNftController.getMetadata);
router.get("/exclusive-nft/info", exclusiveNftController.getGlobalInfo);
router.get("/exclusive-nft/user/:address", exclusiveNftController.getUserInfo);
router.get("/exclusive-nft/holders", authMiddleware.verifyToken, exclusiveNftController.getHolders);
router.post(
    "/exclusive-nft/claim-record",
    authMiddleware.verifyToken,
    validateRequest(validators.claimRecordBody),
    requireBodyWalletOwnership("owner"),
    exclusiveNftController.recordClaim
);

// --- Maintenance ---
router.post(
    "/oddswin/lotteries/sync-participants",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    lotteryController.syncLotteryStats
);

// New alias for namespaced game routes
router.post(
    "/lotteries/sync-participants",
    authMiddleware.verifyToken,
    authMiddleware.isAdmin,
    lotteryController.syncLotteryStats
);

module.exports = router;
