const { ethers } = require("ethers");
const mongoose = require("mongoose");
const User = require("../../models/user.model");
const WalletIdentity = require("../../models/wallet/walletIdentity.model");
const PaymentIntent = require("../../models/payments/paymentIntent.model");
const FundingSession = require("../../models/payments/fundingSession.model");
const PurchaseSession = require("../../models/payments/purchaseSession.model");
const PaymentWebhookEvent = require("../../models/payments/paymentWebhookEvent.model");
const GlobalConfig = require("../../models/oddswin/globalConfig.model");
const { getProvider } = require("../blockchain.service");
const { createLogger } = require("../system/logger.service");
const { resolveRuntimeConfig } = require("../system/featureFlags.service");
const {
    buildFundingPlan,
    evaluatePurchaseReadiness,
    normalizeAddress,
    readLotterySnapshot,
    readWalletBalanceSnapshot,
    roundAmount,
} = require("./balanceVerification.service");

const logger = createLogger("payments");

const ACTIVE_SESSION_STATUSES = new Set(["draft", "waiting_funding", "ready", "submitted", "confirmed"]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const isBalanceGateEnabled = () => Boolean(resolveRuntimeConfig().featureFlags.balanceGateEnabled);
const isFundingSessionEnabled = () => Boolean(resolveRuntimeConfig().featureFlags.onrampEnabled);

const normalizeProviderName = (value) => String(value || "").trim().toLowerCase() || "privy";

const getMinPolBalance = () => Number(resolveRuntimeConfig().purchase?.minPolBalance || 1);
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

const ensurePaymentsFeatureEnabled = () => true;
const ensureFundingSessionEnabled = () => {
    if (isFundingSessionEnabled()) return;
    const error = new Error("ONRAMP_DISABLED");
    error.code = "ONRAMP_DISABLED";
    throw error;
};

const getGlobalUsdtAddress = async () => {
    const config = await GlobalConfig.findOne().select("usdt").lean();
    return normalizeAddress(config?.usdt || "");
};

const getLotterySnapshotByAddress = async (lotteryAddress) => {
    const provider = getProvider();
    return readLotterySnapshot(provider, lotteryAddress);
};

const getUserById = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("USER_NOT_FOUND");
        error.code = "USER_NOT_FOUND";
        throw error;
    }
    return user;
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
    const belongsToUser = legacyWallets.includes(normalizedWallet)
        || normalizeAddress(user.primaryWallet) === normalizedWallet
        || Boolean(await WalletIdentity.findOne({ userId: user._id, address: normalizedWallet }));

    if (!belongsToUser) {
        const error = new Error("WALLET_NOT_LINKED_TO_USER");
        error.code = "WALLET_NOT_LINKED_TO_USER";
        throw error;
    }

    return {
        user,
        walletAddress: normalizedWallet,
        primaryWallet: normalizeAddress(user.primaryWallet) || legacyWallets[0] || normalizedWallet,
        legacyWallets,
    };
};

const resolveExistingActiveDraft = async ({ userId, walletAddress, lotteryAddress, boxQuantity }) => {
    const draft = await PurchaseSession.findOne({
        userId,
        walletAddress,
        lotteryAddress,
        boxQuantity,
        status: { $in: Array.from(ACTIVE_SESSION_STATUSES) },
    }).sort({ createdAt: -1 });

    if (!draft) return null;
    if (draft.expiresAt && new Date(draft.expiresAt).getTime() < Date.now()) {
        draft.status = "expired";
        await draft.save();
        return null;
    }

    return draft;
};

const toFundingSummary = async (sessionId) => {
    const fundingSession = await FundingSession.findById(sessionId)
        .populate("paymentIntentId")
        .populate("purchaseSessionId");

    if (!fundingSession) return null;

    const paymentIntent = fundingSession.paymentIntentId || null;
    const purchaseSession = fundingSession.purchaseSessionId || null;

    return {
        fundingSession,
        paymentIntent,
        purchaseSession,
        checkout: null,
    };
};

const resolveTargetChainNetwork = (targetChain) => {
    const normalized = String(targetChain || "").trim().toLowerCase();
    if (normalized === "eip155:137") return "polygon";
    if (normalized === "eip155:80002") return "amoy";
    return "polygon";
};

const roundCheckoutAmount = (value, decimals = 6) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Number(numeric.toFixed(decimals));
};

const buildOnrampCheckout = ({
    walletAddress,
    fundingPlan,
    fiatCurrency,
}) => {
    const runtime = resolveRuntimeConfig();
    const onrampConfig = runtime.integrations?.onramp || {};
    const provider = normalizeProviderName(onrampConfig.provider);
    const method = String(onrampConfig.method || "moonpay").trim().toLowerCase();
    const targetChain = String(onrampConfig.targetChain || "eip155:137").trim();
    const missingPol = roundCheckoutAmount(fundingPlan?.requiredPol || 0);
    const missingUsdt = roundCheckoutAmount(fundingPlan?.requiredUsdt || 0);
    const minimumFiatAmountUsd = Math.max(0, roundCheckoutAmount(onrampConfig.minFiatAmountUsd || 20));
    const estimatedFeeUsd = Math.max(0, roundCheckoutAmount(onrampConfig.estimatedFeeUsd || 3));
    const polBuffer = Math.max(0, roundCheckoutAmount(onrampConfig.polBuffer || 2));

    const asset = missingUsdt > 0 ? "usdt" : "pol";
    const destinationAmount = asset === "usdt"
        ? Math.max(missingUsdt, minimumFiatAmountUsd)
        : Math.max(missingPol, polBuffer);
    const fiatAmount = asset === "usdt"
        ? roundCheckoutAmount(Math.max(missingUsdt, minimumFiatAmountUsd) + estimatedFeeUsd)
        : roundCheckoutAmount(Math.max(missingPol, polBuffer) + estimatedFeeUsd);

    if (destinationAmount <= 0 || fiatAmount <= 0) return null;

    if (provider !== "privy") {
        const error = new Error("ONRAMP_PROVIDER_NOT_SUPPORTED");
        error.code = "ONRAMP_PROVIDER_NOT_SUPPORTED";
        throw error;
    }

    return {
        provider,
        method,
        asset,
        amount: destinationAmount,
        destinationAmount,
        fiatAmount,
        walletAddress,
        fiatCurrency: String(fiatCurrency || runtime.integrations?.onramp?.defaultFiatCurrency || "cop").trim().toLowerCase(),
        targetChain,
        network: resolveTargetChainNetwork(targetChain),
        minimumFiatAmountUsd,
        estimatedFeeUsd,
        polBuffer,
        url: null,
    };
};

const createFundingIntent = async ({
    userId,
    walletAddress,
    lotteryAddress,
    boxQuantity,
    fiatCurrency,
    provider,
}) => {
    ensurePaymentsFeatureEnabled();
    ensureFundingSessionEnabled();

    const linkedWallet = await resolveLinkedWalletContext({ userId, walletAddress });
    const lotterySnapshot = await getLotterySnapshotByAddress(lotteryAddress);
    const runtimeUsdtAddress = await getGlobalUsdtAddress();
    const skipNativeGasRequirement = shouldSkipNativeGasRequirement({
        linkedWallet,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        runtimeUsdtAddress,
    });
    const walletSnapshot = await readWalletBalanceSnapshot({
        provider: getProvider(),
        walletAddress: linkedWallet.walletAddress,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        minPolBalance: getMinPolBalance(),
        skipNativeGasRequirement,
    });
    const fundingPlan = buildFundingPlan({
        lotterySnapshot,
        walletSnapshot,
        boxQuantity: Number(boxQuantity || 0) || 1,
    });
    const readiness = evaluatePurchaseReadiness({
        balanceSnapshot: {
            requiredUsdt: fundingPlan.requiredUsdt,
            requiredPol: fundingPlan.requiredPol,
            currentUsdtBalance: walletSnapshot.currentUsdtBalance,
            currentPolBalance: walletSnapshot.currentPolBalance,
            minPolBalance: walletSnapshot.minPolBalance,
            skipNativeGasRequirement: walletSnapshot.skipNativeGasRequirement,
        },
        balanceGateEnabled: isBalanceGateEnabled(),
    });

    if (readiness.readyToBuy) {
        return {
            walletAddress: linkedWallet.walletAddress,
            lotterySnapshot,
            walletSnapshot,
            fundingPlan,
            readiness,
            fundingSession: null,
            paymentIntent: null,
            checkout: null,
        };
    }

    const checkout = buildOnrampCheckout({
        walletAddress: linkedWallet.walletAddress,
        fundingPlan,
        fiatCurrency,
    });

    if (!checkout) {
        const error = new Error("ONRAMP_CHECKOUT_NOT_REQUIRED");
        error.code = "ONRAMP_CHECKOUT_NOT_REQUIRED";
        throw error;
    }

    const normalizedProvider = normalizeProviderName(provider || checkout.provider);
    const fundingSession = await FundingSession.create({
        userId,
        walletAddress: linkedWallet.walletAddress,
        provider: normalizedProvider,
        status: "awaiting_payment",
        requiredUsdt: Number(fundingPlan.requiredUsdt || 0),
        requiredPol: Number(fundingPlan.requiredPol || 0),
        minPolBalanceTarget: Number(walletSnapshot.minPolBalance || getMinPolBalance()),
        currentUsdtBalance: Number(walletSnapshot.currentUsdtBalance || 0),
        currentPolBalance: Number(walletSnapshot.currentPolBalance || 0),
        providerPayload: {
            checkout,
            fundingPlan,
            lotteryAddress: normalizeAddress(lotteryAddress),
            boxQuantity: Number(boxQuantity || 0) || 1,
        },
        balanceSnapshot: {
            ...walletSnapshot,
            fundingPlan,
            readiness,
        },
    });

    const paymentIntent = await PaymentIntent.create({
        userId,
        walletAddress: linkedWallet.walletAddress,
        fundingSessionId: fundingSession._id,
        provider: normalizedProvider,
        providerOrderId: `${normalizedProvider}:${String(fundingSession._id)}`,
        fiatCurrency: checkout.fiatCurrency,
        fiatAmount: Number(checkout.fiatAmount || 0),
        targetAsset: checkout.asset,
        targetChain: checkout.targetChain,
        status: "open",
        providerPayload: {
            checkout,
            providerOrderId: `${normalizedProvider}:${String(fundingSession._id)}`,
            fundingPlan,
            lotteryAddress: normalizeAddress(lotteryAddress),
            boxQuantity: Number(boxQuantity || 0) || 1,
        },
    });

    fundingSession.paymentIntentId = paymentIntent._id;
    await fundingSession.save();

    return {
        walletAddress: linkedWallet.walletAddress,
        lotterySnapshot,
        walletSnapshot,
        fundingPlan,
        readiness,
        fundingSession,
        paymentIntent,
        checkout,
    };
};

const getPaymentIntentById = async (intentId, userId = null) => {
    const query = { _id: intentId };
    if (userId) {
        query.userId = userId;
    }
    return PaymentIntent.findOne(query)
        .populate("fundingSessionId")
        .lean();
};

const getFundingSessionById = async (sessionId, userId = null) => {
    const query = { _id: sessionId };
    if (userId) {
        query.userId = userId;
    }
    return FundingSession.findOne(query)
        .populate("paymentIntentId")
        .populate("purchaseSessionId")
        .lean();
};

const getPurchaseReadiness = async ({ userId, draftId, walletAddress = "", lotteryAddress = "", boxQuantity = 0 }) => {
    ensurePaymentsFeatureEnabled();

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

    const fundingSession = purchaseSession.fundingSessionId || await FundingSession.findById(purchaseSession.fundingSessionId);
    const paymentIntent = purchaseSession.paymentIntentId || await PaymentIntent.findById(purchaseSession.paymentIntentId);
    const runtime = resolveRuntimeConfig();
    const lottery = normalizeAddress(lotteryAddress || purchaseSession.lotteryAddress);
    const selectedLottery = lottery || normalizeAddress(purchaseSession.lotteryAddress);

    let latestPlan = purchaseSession.readinessSnapshot?.fundingPlan || null;
    let walletSnapshot = null;

    if (selectedLottery) {
        const lotterySnapshot = await getLotterySnapshotByAddress(selectedLottery);
        const runtimeUsdtAddress = await getGlobalUsdtAddress();
        const skipNativeGasRequirement = shouldSkipNativeGasRequirement({
            linkedWallet,
            stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
            runtimeUsdtAddress,
        });
        walletSnapshot = await readWalletBalanceSnapshot({
            provider: getProvider(),
            walletAddress: linkedWallet.walletAddress,
            stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
            minPolBalance: getMinPolBalance(),
            skipNativeGasRequirement,
        });
        latestPlan = buildFundingPlan({
            lotterySnapshot,
            walletSnapshot,
            boxQuantity: Number(boxQuantity || purchaseSession.boxQuantity || 1),
        });
    }

    const readinessSnapshot = walletSnapshot ? {
        ...walletSnapshot,
        fundingPlan: latestPlan,
    } : purchaseSession.readinessSnapshot || {};

    const readiness = evaluatePurchaseReadiness({
        balanceSnapshot: {
            requiredUsdt: latestPlan?.requiredUsdt ?? purchaseSession.expectedUsdt,
            requiredPol: latestPlan?.requiredPol ?? purchaseSession.expectedPol,
            currentUsdtBalance: walletSnapshot?.currentUsdtBalance ?? 0,
            currentPolBalance: walletSnapshot?.currentPolBalance ?? 0,
            minPolBalance: walletSnapshot?.minPolBalance ?? getMinPolBalance(),
            skipNativeGasRequirement: walletSnapshot?.skipNativeGasRequirement ?? false,
        },
        balanceGateEnabled: runtime.featureFlags.balanceGateEnabled,
    });

    const nextStatus = readiness.readyToBuy
        ? "ready"
        : (purchaseSession.status || "created");

    if (readiness.readyToBuy) {
        if (fundingSession && fundingSession.status !== "ready") {
            fundingSession.status = "ready";
            fundingSession.balanceVerifiedAt = new Date();
            fundingSession.readyForPurchaseAt = new Date();
            fundingSession.balanceSnapshot = {
                ...(fundingSession.balanceSnapshot || {}),
                ...readinessSnapshot,
            };
            await fundingSession.save();
        }

        if (purchaseSession.status !== "ready") {
            purchaseSession.status = "ready";
            purchaseSession.readyForPurchaseAt = new Date();
            purchaseSession.readinessSnapshot = {
                ...(purchaseSession.readinessSnapshot || {}),
                ...readinessSnapshot,
                readyToBuy: true,
            };
            await purchaseSession.save();
        }
    } else {
        purchaseSession.readinessSnapshot = {
            ...(purchaseSession.readinessSnapshot || {}),
            ...readinessSnapshot,
            readyToBuy: false,
            balanceGateEnabled: runtime.featureFlags.balanceGateEnabled,
        };
        if (purchaseSession.status === "draft") {
            purchaseSession.status = "created";
        }
        await purchaseSession.save();
    }

    return {
        purchaseSession,
        fundingSession,
        paymentIntent,
        walletAddress: linkedWallet.walletAddress,
        readinessSnapshot,
        readiness: {
            ...readiness,
            purchaseSessionStatus: nextStatus,
        },
    };
};

const getWalletBalanceCheck = async ({ userId, walletAddress, lotteryAddress, boxQuantity = 0 }) => {
    ensurePaymentsFeatureEnabled();

    const linkedWallet = await resolveLinkedWalletContext({ userId, walletAddress });
    const lotterySnapshot = await getLotterySnapshotByAddress(lotteryAddress);
    const runtimeUsdtAddress = await getGlobalUsdtAddress();
    const skipNativeGasRequirement = shouldSkipNativeGasRequirement({
        linkedWallet,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        runtimeUsdtAddress,
    });
    const walletSnapshot = await readWalletBalanceSnapshot({
        provider: getProvider(),
        walletAddress: linkedWallet.walletAddress,
        stableCoinAddress: lotterySnapshot.stableCoinAddress || runtimeUsdtAddress,
        minPolBalance: getMinPolBalance(),
        skipNativeGasRequirement,
    });
    const fundingPlan = buildFundingPlan({
        lotterySnapshot,
        walletSnapshot,
        boxQuantity: Number(boxQuantity || 0) || 1,
    });

    const readiness = evaluatePurchaseReadiness({
        balanceSnapshot: {
            requiredUsdt: fundingPlan.requiredUsdt,
            requiredPol: fundingPlan.requiredPol,
            currentUsdtBalance: walletSnapshot.currentUsdtBalance,
            currentPolBalance: walletSnapshot.currentPolBalance,
            minPolBalance: walletSnapshot.minPolBalance,
            skipNativeGasRequirement: walletSnapshot.skipNativeGasRequirement,
        },
        balanceGateEnabled: isBalanceGateEnabled(),
    });

    return {
        walletAddress: linkedWallet.walletAddress,
        lotterySnapshot,
        walletSnapshot,
        fundingPlan,
        readiness,
    };
};

const extractRequestSignature = (req, providerName) => {
    const headerCandidates = [
        "x-onramp-signature",
        "x-webhook-signature",
        "x-trustplay-signature",
        "x-signature",
        "authorization",
    ];

    for (const headerName of headerCandidates) {
        const value = req.header(headerName);
        if (value) return String(value).trim();
    }

    return "";
};

const findIntentByWebhookReference = async (provider, reference) => {
    const normalizedReference = String(reference || "").trim();
    if (!normalizedReference) return null;

    const objectIdLike = normalizedReference.length === 24 && /^[a-fA-F0-9]+$/.test(normalizedReference);

    const query = {
        provider: normalizeProviderName(provider),
        $or: [
            { providerReference: normalizedReference },
            { providerOrderId: normalizedReference },
        ],
    };

    if (objectIdLike) {
        query.$or.push({ _id: new mongoose.Types.ObjectId(normalizedReference) });
    }

    return PaymentIntent.findOne(query);
};

const processWebhookEvent = async ({ req, body }) => {
    ensurePaymentsFeatureEnabled();
    ensureFundingSessionEnabled();
    const error = new Error("ONRAMP_WEBHOOK_NOT_IMPLEMENTED");
    error.code = "ONRAMP_WEBHOOK_NOT_IMPLEMENTED";
    throw error;
};

const getPurchaseSessionSummary = async ({ userId, draftId, walletAddress, lotteryAddress, boxQuantity }) => {
    ensurePaymentsFeatureEnabled();

    const readiness = await getPurchaseReadiness({
        userId,
        draftId,
        walletAddress,
        lotteryAddress,
        boxQuantity,
    });

    return {
        ...readiness,
        featureFlags: {
            balanceGateEnabled: isBalanceGateEnabled(),
        },
    };
};

module.exports = {
    createFundingIntent,
    getFundingSessionById,
    getPaymentIntentById,
    getPurchaseReadiness,
    getPurchaseSessionSummary,
    getWalletBalanceCheck,
    isBalanceGateEnabled,
    isFundingSessionEnabled,
    normalizeProviderName,
    processWebhookEvent,
    resolveLinkedWalletContext,
    toFundingSummary,
};
