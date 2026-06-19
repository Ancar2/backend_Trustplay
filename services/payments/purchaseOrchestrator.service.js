const { ethers } = require("ethers");

const User = require("../../models/user.model");
const WalletIdentity = require("../../models/wallet/walletIdentity.model");
const PaymentIntent = require("../../models/payments/paymentIntent.model");
const FundingSession = require("../../models/payments/fundingSession.model");
const PurchaseSession = require("../../models/payments/purchaseSession.model");
const GlobalConfig = require("../../models/oddswin/globalConfig.model");
const { getProvider } = require("../blockchain.service");
const { createLogger } = require("../system/logger.service");
const { resolveRuntimeConfig } = require("../system/featureFlags.service");
const {
    buildFundingPlan,
    evaluatePurchaseReadiness,
    normalizeAddress,
    readLotterySnapshot,
    readTokenDecimals,
    readWalletBalanceSnapshot,
    roundAmount,
} = require("./balanceVerification.service");
const { getPurchaseSessionSummary } = require("./fundingSession.service");

const logger = createLogger("purchase-orchestrator");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ALLOWANCE_OK = "ALLOWANCE_OK";
const ALLOWANCE_REQUIRED = "ALLOWANCE_REQUIRED";

const ACTIVE_PURCHASE_STATUSES = new Set([
    "draft",
    "created",
    "waiting_funding",
    "ready",
    "awaiting_signature",
    "signing",
    "submitted",
    "tx_submitted",
    "confirmed",
    "tx_confirmed",
    "syncing",
]);

const LEGACY_STATUS_MAP = new Map([
    ["draft", "created"],
    ["waiting_funding", "created"],
    ["signing", "awaiting_signature"],
    ["submitted", "tx_submitted"],
    ["confirmed", "tx_confirmed"],
    ["synced", "completed"],
]);

const ensurePurchaseOrchestratorEnabled = () => {
    const runtime = resolveRuntimeConfig();
    if (!runtime.featureFlags.purchaseOrchestratorEnabled) {
        const error = new Error("PURCHASE_ORCHESTRATOR_DISABLED");
        error.code = "PURCHASE_ORCHESTRATOR_DISABLED";
        throw error;
    }
};

const isPurchaseOrchestratorEnabled = () => Boolean(resolveRuntimeConfig().featureFlags.purchaseOrchestratorEnabled);

const getUserById = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("USER_NOT_FOUND");
        error.code = "USER_NOT_FOUND";
        throw error;
    }
    return user;
};

const normalizeStatus = (status) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "created";
    return LEGACY_STATUS_MAP.get(normalized) || normalized;
};

const getRuntimeFactoryAddress = async () => {
    const config = await GlobalConfig.findOne().select("factory").lean();
    return normalizeAddress(config?.factory || "");
};

const getRuntimeUsdtAddress = async () => {
    const config = await GlobalConfig.findOne().select("usdt").lean();
    return normalizeAddress(config?.usdt || "");
};

const getRuntimeMinPolBalance = () => Number(resolveRuntimeConfig().purchase?.minPolBalance || 1);
const isPrivyGasTokenPaymentsEnabled = () => Boolean(resolveRuntimeConfig().integrations?.privy?.gasTokenPaymentsEnabled);

const shouldSkipNativeGasRequirement = ({
    linkedWallet = null,
    stableCoinAddress = "",
    runtimeUsdtAddress = "",
}) => {
    if (!isPrivyGasTokenPaymentsEnabled()) return false;

    const normalizedStableCoinAddress = normalizeAddress(stableCoinAddress);
    const normalizedRuntimeUsdtAddress = normalizeAddress(runtimeUsdtAddress);
    if (!normalizedStableCoinAddress || normalizedStableCoinAddress !== normalizedRuntimeUsdtAddress) {
        return false;
    }

    const provider = String(linkedWallet?.walletIdentity?.provider || "").trim().toLowerCase();
    const walletType = String(linkedWallet?.walletIdentity?.walletType || "").trim().toLowerCase();

    return provider === "privy" && walletType === "embedded";
};

const loadFundingSessionForPurchase = async ({ purchaseSession, userId, walletAddress, lotteryAddress }) => {
    if (purchaseSession?.fundingSessionId) {
        const fundingSession = await FundingSession.findById(purchaseSession.fundingSessionId);
        if (fundingSession) return fundingSession;
    }

    if (purchaseSession?.paymentIntentId) {
        const intent = await PaymentIntent.findById(purchaseSession.paymentIntentId).lean();
        if (intent?.fundingSessionId) {
            const fundingSession = await FundingSession.findById(intent.fundingSessionId);
            if (fundingSession) return fundingSession;
        }
    }

    if (!userId || !walletAddress) return null;

    const query = {
        userId,
        walletAddress: normalizeAddress(walletAddress),
    };

    const fundingSessions = await FundingSession.find(query)
        .sort({ createdAt: -1 })
        .limit(10);

    if (!fundingSessions.length) return null;

    if (!lotteryAddress) return fundingSessions[0];

    const normalizedLottery = normalizeAddress(lotteryAddress);
    const matched = fundingSessions.find((session) => {
        const sessionLottery = normalizeAddress(session?.providerPayload?.lotteryAddress || "");
        return !normalizedLottery || sessionLottery === normalizedLottery;
    });

    return matched || fundingSessions[0];
};

const loadPaymentIntentForPurchase = async ({ purchaseSession, fundingSession }) => {
    if (purchaseSession?.paymentIntentId) {
        const paymentIntent = await PaymentIntent.findById(purchaseSession.paymentIntentId);
        if (paymentIntent) return paymentIntent;
    }

    if (fundingSession?.paymentIntentId) {
        return PaymentIntent.findById(fundingSession.paymentIntentId);
    }

    return null;
};

const resolveLinkedWalletContext = async ({ userId, walletAddress }) => {
    const user = await getUserById(userId);
    const normalizedWallet = normalizeAddress(walletAddress || user.primaryWallet || (Array.isArray(user.wallets) ? user.wallets[0] : ""));

    if (!normalizedWallet) {
        const error = new Error("WALLET_ADDRESS_REQUIRED");
        error.code = "WALLET_ADDRESS_REQUIRED";
        throw error;
    }

    const legacyWallets = Array.isArray(user.wallets)
        ? user.wallets.map(normalizeAddress).filter(Boolean)
        : [];

    const walletIdentity = await WalletIdentity.findOne({ userId: user._id, address: normalizedWallet });
    const belongsToUser = legacyWallets.includes(normalizedWallet)
        || normalizeAddress(user.primaryWallet) === normalizedWallet
        || Boolean(walletIdentity);

    if (!belongsToUser) {
        const error = new Error("WALLET_NOT_ASSOCIATED");
        error.code = "WALLET_NOT_ASSOCIATED";
        throw error;
    }

    if (walletIdentity) {
        if (walletIdentity.status === "blocked") {
            const error = new Error("WALLET_BLOCKED");
            error.code = "WALLET_BLOCKED";
            throw error;
        }

        if (walletIdentity.status !== "active") {
            const error = new Error("WALLET_NOT_ACTIVE");
            error.code = "WALLET_NOT_ACTIVE";
            throw error;
        }

        if (!walletIdentity.isVerified) {
            const error = new Error("WALLET_NOT_VERIFIED");
            error.code = "WALLET_NOT_VERIFIED";
            throw error;
        }
    }

    return {
        user,
        walletAddress: normalizedWallet,
        primaryWallet: normalizeAddress(user.primaryWallet) || legacyWallets[0] || normalizedWallet,
        legacyWallets,
        walletIdentity: walletIdentity ? walletIdentity.toObject() : null,
    };
};

const resolveAllowance = async ({ walletAddress, tokenAddress, spenderAddress }) => {
    const normalizedToken = normalizeAddress(tokenAddress);
    const normalizedWallet = normalizeAddress(walletAddress);
    const normalizedSpender = normalizeAddress(spenderAddress);

    if (!normalizedToken || !normalizedWallet || !normalizedSpender) {
        return {
            allowance: 0,
            allowanceState: ALLOWANCE_REQUIRED,
        };
    }

    try {
        const provider = getProvider();
        const decimals = await readTokenDecimals(provider, normalizedToken);
        const tokenContract = new ethers.Contract(
            normalizedToken,
            [
                "function allowance(address owner, address spender) view returns (uint256)",
            ],
            provider
        );
        const rawAllowance = await tokenContract.allowance(normalizedWallet, normalizedSpender);
        const allowance = Number(ethers.formatUnits(rawAllowance, decimals));
        const normalizedAllowance = Number.isFinite(allowance) ? roundAmount(allowance, decimals) : 0;

        return {
            allowance: normalizedAllowance,
            allowanceState: normalizedAllowance > 0 ? ALLOWANCE_OK : ALLOWANCE_REQUIRED,
        };
    } catch (error) {
        logger.warn("allowance_read_failed", {
            walletAddress: normalizedWallet,
            tokenAddress: normalizedToken,
            spenderAddress: normalizedSpender,
            message: String(error?.message || error || ""),
        });
        return {
            allowance: 0,
            allowanceState: ALLOWANCE_REQUIRED,
        };
    }
};

const buildReadinessBlockers = ({
    walletContext,
    readinessCore,
    allowanceState,
}) => {
    const blockers = [];

    if (!walletContext.walletIdentity && !walletContext.legacyWallets.includes(walletContext.walletAddress)) {
        blockers.push({
            code: "WALLET_NOT_ASSOCIATED",
            message: "La wallet no está asociada al usuario.",
        });
    }

    if (walletContext.walletIdentity && !walletContext.walletIdentity.isVerified) {
        blockers.push({
            code: "WALLET_NOT_VERIFIED",
            message: "La wallet debe verificarse antes de comprar.",
        });
    }

    if (!readinessCore.hasEnoughUsdt) {
        blockers.push({
            code: "USDT_INSUFFICIENT",
            message: "No hay suficiente USDT para esta compra.",
        });
    }

    if (!readinessCore.hasEnoughPol) {
        blockers.push({
            code: "POL_INSUFFICIENT",
            message: "No hay suficiente POL para cumplir el saldo mínimo.",
        });
    }

    if (allowanceState !== ALLOWANCE_OK) {
        blockers.push({
            code: "ALLOWANCE_REQUIRED",
            message: "La allowance de USDT para la factory es insuficiente.",
        });
    }

    return blockers;
};

const mapPurchaseSessionPayload = async (purchaseSession) => {
    if (!purchaseSession) return null;

    const fundingSession = purchaseSession.fundingSessionId
        ? await FundingSession.findById(purchaseSession.fundingSessionId).lean()
        : null;
    const paymentIntent = purchaseSession.paymentIntentId
        ? await PaymentIntent.findById(purchaseSession.paymentIntentId).lean()
        : null;

    return {
        purchaseSession,
        fundingSession,
        paymentIntent,
    };
};

const composeReadiness = async ({
    userId,
    draftId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
    mutate = false,
}) => {
    const runtime = resolveRuntimeConfig();
    const purchaseSession = await PurchaseSession.findById(draftId)
        .populate("fundingSessionId")
        .populate("paymentIntentId");

    if (!purchaseSession) {
        const error = new Error("PURCHASE_SESSION_NOT_FOUND");
        error.code = "PURCHASE_SESSION_NOT_FOUND";
        throw error;
    }

    if (userId && String(purchaseSession.userId) !== String(userId)) {
        const error = new Error("PURCHASE_SESSION_FORBIDDEN");
        error.code = "PURCHASE_SESSION_FORBIDDEN";
        throw error;
    }

    const linkedWallet = await resolveLinkedWalletContext({
        userId: purchaseSession.userId,
        walletAddress: walletAddress || purchaseSession.walletAddress,
    });

    const normalizedLottery = normalizeAddress(lotteryAddress || purchaseSession.lotteryAddress);
    const fundingSession = purchaseSession.fundingSessionId
        || await loadFundingSessionForPurchase({
            purchaseSession,
            userId: purchaseSession.userId,
            walletAddress: linkedWallet.walletAddress,
            lotteryAddress: normalizedLottery,
        });
    const paymentIntent = purchaseSession.paymentIntentId
        || await loadPaymentIntentForPurchase({ purchaseSession, fundingSession });

    const provider = getProvider();
    const lotterySnapshot = normalizedLottery
        ? await readLotterySnapshot(provider, normalizedLottery)
        : null;
    const stableCoinAddress = normalizeAddress(
        lotterySnapshot?.stableCoinAddress
        || fundingSession?.balanceSnapshot?.stableCoinAddress
        || paymentIntent?.providerPayload?.fundingPlan?.stableCoinAddress
        || await getRuntimeUsdtAddress()
    );
    const runtimeUsdtAddress = await getRuntimeUsdtAddress();
    const skipNativeGasRequirement = shouldSkipNativeGasRequirement({
        linkedWallet,
        stableCoinAddress,
        runtimeUsdtAddress,
    });

    const walletSnapshot = await readWalletBalanceSnapshot({
        provider,
        walletAddress: linkedWallet.walletAddress,
        stableCoinAddress,
        minPolBalance: getRuntimeMinPolBalance(),
        skipNativeGasRequirement,
    });

    const fundingPlan = lotterySnapshot
        ? buildFundingPlan({
            lotterySnapshot,
            walletSnapshot,
            boxQuantity: Number(boxQuantity || purchaseSession.boxQuantity || 1),
        })
        : {
            boxQuantity: Number(boxQuantity || purchaseSession.boxQuantity || 1),
            boxPrice: Number(purchaseSession.expectedUsdt || 0) / Math.max(1, Number(boxQuantity || purchaseSession.boxQuantity || 1)),
            purchaseCost: Number(purchaseSession.expectedUsdt || 0),
            currentUsdtBalance: walletSnapshot.currentUsdtBalance,
            currentPolBalance: walletSnapshot.currentPolBalance,
            minPolBalance: walletSnapshot.minPolBalance,
            requiredUsdt: Number(purchaseSession.expectedUsdt || 0),
            requiredPol: Number(purchaseSession.expectedPol || 0),
            readyToBuy: false,
            needsUsdt: Number(purchaseSession.expectedUsdt || 0) > walletSnapshot.currentUsdtBalance,
            needsPol: Number(purchaseSession.expectedPol || 0) > 0,
            stableCoinAddress,
            stableCoinDecimals: walletSnapshot.stableCoinDecimals,
            walletAddress: linkedWallet.walletAddress,
            lotteryAddress: normalizeAddress(purchaseSession.lotteryAddress),
        };

    const factoryAddress = await getRuntimeFactoryAddress();
    const { allowance, allowanceState } = await resolveAllowance({
        walletAddress: linkedWallet.walletAddress,
        tokenAddress: stableCoinAddress,
        spenderAddress: factoryAddress,
    });

    const balanceReadiness = evaluatePurchaseReadiness({
        balanceSnapshot: {
            requiredUsdt: fundingPlan.requiredUsdt,
            requiredPol: fundingPlan.requiredPol,
            currentUsdtBalance: walletSnapshot.currentUsdtBalance,
            currentPolBalance: walletSnapshot.currentPolBalance,
            minPolBalance: walletSnapshot.minPolBalance,
            skipNativeGasRequirement: walletSnapshot.skipNativeGasRequirement,
        },
        balanceGateEnabled: true,
    });

    const fundingConfirmed = true;
    const walletVerified = !linkedWallet.walletIdentity || Boolean(linkedWallet.walletIdentity.isVerified);
    const hasEnoughUsdt = balanceReadiness.hasEnoughUsdt && walletSnapshot.currentUsdtBalance >= fundingPlan.requiredUsdt;
    const hasEnoughPol = balanceReadiness.hasEnoughPol
        && (walletSnapshot.skipNativeGasRequirement || walletSnapshot.currentPolBalance >= walletSnapshot.minPolBalance);
    const allowanceOk = allowanceState === ALLOWANCE_OK && allowance >= Number(fundingPlan.requiredUsdt || 0);
    const blockers = buildReadinessBlockers({
        walletContext: linkedWallet,
        readinessCore: {
            hasEnoughUsdt,
            hasEnoughPol,
        },
        allowanceState,
    });

    const readyToBuy = blockers.length === 0 && walletVerified && hasEnoughUsdt && hasEnoughPol && allowanceOk;

    const readinessSnapshot = {
        orchestratorEnabled: isPurchaseOrchestratorEnabled(),
        walletLinked: true,
        walletVerified,
        fundingConfirmed,
        allowanceState,
        allowance,
        readyToBuy,
        blockers,
        fundingPlan,
        walletSnapshot,
        balanceGateEnabled: true,
        updatedAt: new Date().toISOString(),
    };

    if (mutate) {
        if (readyToBuy) {
            purchaseSession.status = "ready";
            purchaseSession.readyForPurchaseAt = purchaseSession.readyForPurchaseAt || new Date();
        } else if (!["failed", "cancelled", "completed", "tx_confirmed", "tx_submitted", "syncing"].includes(normalizeStatus(purchaseSession.status || "created"))) {
            purchaseSession.status = "created";
        }

        purchaseSession.walletAddress = linkedWallet.walletAddress;
        purchaseSession.readinessSnapshot = {
            ...(purchaseSession.readinessSnapshot || {}),
            ...readinessSnapshot,
        };
        await purchaseSession.save();
    }

    return {
        purchaseSession,
        fundingSession,
        paymentIntent,
        walletAddress: linkedWallet.walletAddress,
        walletContext: linkedWallet,
        readinessSnapshot,
        readiness: {
            balanceGateEnabled: true,
            allowanceState,
            allowance,
            hasEnoughUsdt,
            hasEnoughPol,
            missingUsdt: roundAmount(Math.max(0, Number(fundingPlan.requiredUsdt || 0) - walletSnapshot.currentUsdtBalance)),
            missingPol: walletSnapshot.skipNativeGasRequirement
                ? 0
                : roundAmount(Math.max(0, walletSnapshot.minPolBalance - walletSnapshot.currentPolBalance)),
            skipNativeGasRequirement: walletSnapshot.skipNativeGasRequirement,
            readyToBuy,
            blockers,
            fundingConfirmed,
            walletVerified,
            purchaseSessionStatus: normalizeStatus(purchaseSession.status || "created"),
        },
        fundingPlan,
        walletSnapshot,
        lotterySnapshot,
        featureFlags: runtime.featureFlags,
        allowanceState,
    };
};

const createPurchaseDraft = async ({
    userId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
    fundingSessionId = null,
    paymentIntentId = null,
}) => {
    ensurePurchaseOrchestratorEnabled();

    const linkedWallet = await resolveLinkedWalletContext({ userId, walletAddress });
    const normalizedLottery = normalizeAddress(lotteryAddress);
    const quantity = Math.max(1, Math.floor(Number(boxQuantity || 0)));

    if (!normalizedLottery) {
        const error = new Error("INVALID_LOTTERY_ADDRESS");
        error.code = "INVALID_LOTTERY_ADDRESS";
        throw error;
    }

    const existingDraft = await PurchaseSession.findOne({
        userId: linkedWallet.user._id,
        walletAddress: linkedWallet.walletAddress,
        lotteryAddress: normalizedLottery,
        boxQuantity: quantity,
        status: { $in: Array.from(ACTIVE_PURCHASE_STATUSES) },
    }).sort({ createdAt: -1 });

    if (existingDraft) {
        existingDraft.readinessSnapshot = {
            ...(existingDraft.readinessSnapshot || {}),
            orchestratorEnabled: true,
            reusedDraft: true,
        };
        await existingDraft.save();
        return composeReadiness({
            userId,
            draftId: existingDraft._id,
            walletAddress: linkedWallet.walletAddress,
            lotteryAddress: normalizedLottery,
            boxQuantity: quantity,
            mutate: true,
        });
    }

    const provider = getProvider();
    const lotterySnapshot = await readLotterySnapshot(provider, normalizedLottery);
    const runtimeUsdtAddress = await getRuntimeUsdtAddress();
    const skipNativeGasRequirement = shouldSkipNativeGasRequirement({
        linkedWallet,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        runtimeUsdtAddress,
    });
    const walletSnapshot = await readWalletBalanceSnapshot({
        provider,
        walletAddress: linkedWallet.walletAddress,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        minPolBalance: getRuntimeMinPolBalance(),
        skipNativeGasRequirement,
    });
    const fundingPlan = buildFundingPlan({
        lotterySnapshot,
        walletSnapshot,
        boxQuantity: quantity,
    });

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const purchaseSession = await PurchaseSession.create({
        userId: linkedWallet.user._id,
        walletAddress: linkedWallet.walletAddress,
        lotteryAddress: normalizedLottery,
        boxQuantity: quantity,
        expectedUsdt: fundingPlan.requiredUsdt,
        expectedPol: fundingPlan.requiredPol,
        fundingSessionId: fundingSessionId || null,
        paymentIntentId: paymentIntentId || null,
        status: "created",
        readinessSnapshot: {
            orchestratorEnabled: true,
            createdAt: new Date().toISOString(),
            readyToBuy: false,
            fundingPlan,
        },
        purchaseRequestPayload: {
            userId: String(linkedWallet.user._id),
            walletAddress: linkedWallet.walletAddress,
            lotteryAddress: normalizedLottery,
            boxQuantity: quantity,
            fundingSessionId,
            paymentIntentId,
        },
        expiresAt,
    });

    logger.info("purchase_draft_created", {
        userId: String(linkedWallet.user._id),
        walletAddress: linkedWallet.walletAddress,
        lotteryAddress: normalizedLottery,
        boxQuantity: quantity,
        purchaseSessionId: String(purchaseSession._id),
    });

    return composeReadiness({
        userId,
        draftId: purchaseSession._id,
        walletAddress: linkedWallet.walletAddress,
        lotteryAddress: normalizedLottery,
        boxQuantity: quantity,
        mutate: true,
    });
};

const preparePurchaseDraft = async ({
    userId,
    draftId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
}) => {
    ensurePurchaseOrchestratorEnabled();
    return composeReadiness({
        userId,
        draftId,
        walletAddress,
        lotteryAddress,
        boxQuantity,
        mutate: true,
    });
};

const getPurchaseDraftStatus = async ({ userId, draftId }) => {
    const purchaseSession = await PurchaseSession.findById(draftId)
        .populate("fundingSessionId")
        .populate("paymentIntentId");

    if (!purchaseSession) {
        const error = new Error("PURCHASE_SESSION_NOT_FOUND");
        error.code = "PURCHASE_SESSION_NOT_FOUND";
        throw error;
    }

    if (userId && String(purchaseSession.userId) !== String(userId)) {
        const error = new Error("PURCHASE_SESSION_FORBIDDEN");
        error.code = "PURCHASE_SESSION_FORBIDDEN";
        throw error;
    }

    const readiness = await composeReadiness({
        userId,
        draftId,
        walletAddress: purchaseSession.walletAddress,
        lotteryAddress: purchaseSession.lotteryAddress,
        boxQuantity: purchaseSession.boxQuantity,
        mutate: false,
    });

    return {
        ...readiness,
        purchaseSession: readiness.purchaseSession || purchaseSession,
    };
};

const transitionPurchaseDraft = async ({
    userId,
    draftId,
    status,
    txHash = "",
    errorMessage = "",
    extra = {},
}) => {
    ensurePurchaseOrchestratorEnabled();

    const purchaseSession = await PurchaseSession.findById(draftId);
    if (!purchaseSession) {
        const error = new Error("PURCHASE_SESSION_NOT_FOUND");
        error.code = "PURCHASE_SESSION_NOT_FOUND";
        throw error;
    }

    if (userId && String(purchaseSession.userId) !== String(userId)) {
        const error = new Error("PURCHASE_SESSION_FORBIDDEN");
        error.code = "PURCHASE_SESSION_FORBIDDEN";
        throw error;
    }

    const normalizedStatus = normalizeStatus(status);
    const now = new Date();

    purchaseSession.status = normalizedStatus;
    purchaseSession.txHash = txHash || purchaseSession.txHash || "";
    purchaseSession.errorMessage = errorMessage || purchaseSession.errorMessage || "";
    purchaseSession.readinessSnapshot = {
        ...(purchaseSession.readinessSnapshot || {}),
        ...extra,
        status: normalizedStatus,
        txHash: txHash || purchaseSession.txHash || "",
        updatedAt: now.toISOString(),
    };

    if (normalizedStatus === "awaiting_signature") {
        purchaseSession.readinessSnapshot.signatureRequestedAt = now.toISOString();
    }

    if (normalizedStatus === "tx_submitted") {
        purchaseSession.submittedAt = now;
    }

    if (normalizedStatus === "tx_confirmed") {
        purchaseSession.confirmedAt = now;
    }

    if (normalizedStatus === "syncing") {
        purchaseSession.readinessSnapshot.syncingAt = now.toISOString();
    }

    if (normalizedStatus === "completed") {
        purchaseSession.syncedAt = now;
        purchaseSession.readinessSnapshot.completedAt = now.toISOString();
    }

    if (normalizedStatus === "failed" || normalizedStatus === "cancelled") {
        purchaseSession.readinessSnapshot.terminalStatus = normalizedStatus;
    }

    await purchaseSession.save();

    logger.info("purchase_stage_transition", {
        userId: String(purchaseSession.userId),
        purchaseSessionId: String(purchaseSession._id),
        status: normalizedStatus,
        txHash: purchaseSession.txHash || "",
    });

    return mapPurchaseSessionPayload(purchaseSession);
};

const getLegacyPurchaseReadiness = async ({
    userId,
    draftId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
}) => {
    const summary = await getPurchaseSessionSummary({
        userId,
        draftId,
        walletAddress,
        lotteryAddress,
        boxQuantity,
    });

    const purchaseSession = summary.purchaseSession || await PurchaseSession.findById(draftId).lean();
    return {
        purchaseSession,
        fundingSession: summary.fundingSession || null,
        paymentIntent: summary.paymentIntent || null,
        walletAddress: summary.walletAddress || normalizeAddress(walletAddress),
        readinessSnapshot: summary.readinessSnapshot || {},
        readiness: {
            ...(summary.readiness || {}),
            allowanceState: ALLOWANCE_OK,
            allowance: Number.MAX_SAFE_INTEGER,
            walletVerified: true,
            fundingConfirmed: true,
        },
        featureFlags: summary.featureFlags || resolveRuntimeConfig().featureFlags,
        fundingPlan: summary.readinessSnapshot?.fundingPlan || purchaseSession?.readinessSnapshot?.fundingPlan || null,
        walletSnapshot: summary.readinessSnapshot || null,
    };
};

const getPurchaseReadiness = async ({
    userId,
    draftId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
}) => {
    if (!isPurchaseOrchestratorEnabled()) {
        return getLegacyPurchaseReadiness({
            userId,
            draftId,
            walletAddress,
            lotteryAddress,
            boxQuantity,
        });
    }

    return composeReadiness({
        userId,
        draftId,
        walletAddress,
        lotteryAddress,
        boxQuantity,
        mutate: true,
    });
};

module.exports = {
    ALLOWANCE_OK,
    ALLOWANCE_REQUIRED,
    createPurchaseDraft,
    ensurePurchaseOrchestratorEnabled,
    getLegacyPurchaseReadiness,
    getPurchaseDraftStatus,
    getPurchaseReadiness,
    isPurchaseOrchestratorEnabled,
    normalizeStatus,
    preparePurchaseDraft,
    resolveAllowance,
    resolveLinkedWalletContext,
    transitionPurchaseDraft,
};
