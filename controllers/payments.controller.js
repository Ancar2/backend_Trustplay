const {
    createFundingIntent,
    getWalletBalanceCheck,
    isBalanceGateEnabled,
    isFundingSessionEnabled,
} = require("../services/payments/fundingSession.service");
const {
    createPurchaseDraft,
    getPurchaseDraftStatus,
    getPurchaseReadiness: getPurchaseOrchestratorReadiness,
    preparePurchaseDraft,
    transitionPurchaseDraft,
} = require("../services/payments/purchaseOrchestrator.service");
const { resolveRuntimeConfig } = require("../services/system/featureFlags.service");

const respondWithError = (res, error, defaultMessage = "Error procesando el flujo de fondeo") => {
    const code = String(error?.code || "").trim();

    if (code === "USER_NOT_FOUND") {
        return res.status(404).json({ ok: false, msj: "Usuario no encontrado", code });
    }

    if (code === "WALLET_ADDRESS_REQUIRED" || code === "INVALID_LOTTERY_ADDRESS" || code === "PURCHASE_SESSION_NOT_FOUND") {
        return res.status(400).json({ ok: false, msj: error.message || defaultMessage, code });
    }

    if (code === "WALLET_NOT_LINKED_TO_USER" || code === "PURCHASE_SESSION_FORBIDDEN") {
        return res.status(403).json({ ok: false, msj: "La wallet no pertenece al usuario autenticado.", code });
    }

    if (code === "WALLET_NOT_ASSOCIATED" || code === "WALLET_NOT_VERIFIED" || code === "WALLET_NOT_ACTIVE") {
        return res.status(403).json({ ok: false, msj: "La wallet no está lista para operar.", code });
    }

    if (code === "WALLET_BLOCKED") {
        return res.status(403).json({ ok: false, msj: "La wallet está bloqueada.", code });
    }

    if (code === "PURCHASE_ORCHESTRATOR_DISABLED") {
        return res.status(403).json({ ok: false, msj: "El Purchase Orchestrator está deshabilitado.", code });
    }

    if (code === "ONRAMP_DISABLED") {
        return res.status(403).json({ ok: false, msj: "El onramp está deshabilitado.", code });
    }

    if (code === "ONRAMP_PROVIDER_NOT_SUPPORTED") {
        return res.status(400).json({ ok: false, msj: error.message || defaultMessage, code });
    }

    return res.status(500).json({
        ok: false,
        msj: error?.message || defaultMessage,
        code: code || "PAYMENTS_ERROR",
    });
};

const getUserId = (req) => req.user?.id || req.user?.userId || null;

const paymentsController = {
    balanceCheck: async (req, res) => {
        try {
            const result = await getWalletBalanceCheck({
                userId: getUserId(req),
                walletAddress: req.params.address || "",
                lotteryAddress: req.query?.lotteryAddress || req.body?.lotteryAddress || "",
                boxQuantity: req.query?.boxQuantity || req.body?.boxQuantity || 0,
            });

            return res.status(200).json({
                ok: true,
                walletAddress: result.walletAddress,
                lotterySnapshot: result.lotterySnapshot,
                walletSnapshot: result.walletSnapshot,
                fundingPlan: result.fundingPlan,
                readiness: result.readiness,
            });
        } catch (error) {
            console.error("Error verificando balance:", error);
            return respondWithError(res, error, "Error verificando balances");
        }
    },

    createOnrampCheckout: async (req, res) => {
        try {
            const result = await createFundingIntent({
                userId: getUserId(req),
                walletAddress: req.body?.walletAddress || "",
                lotteryAddress: req.body?.lotteryAddress || "",
                boxQuantity: req.body?.boxQuantity || 0,
                fiatCurrency: req.body?.fiatCurrency || "",
                provider: req.body?.provider || "",
            });

            return res.status(201).json({
                ok: true,
                msj: result.checkout
                    ? "Checkout onramp creado correctamente."
                    : "La wallet ya tiene fondos suficientes.",
                walletAddress: result.walletAddress,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
                fundingPlan: result.fundingPlan,
                walletSnapshot: result.walletSnapshot,
                lotterySnapshot: result.lotterySnapshot,
                readiness: result.readiness,
                checkout: result.checkout,
            });
        } catch (error) {
            console.error("Error creando checkout onramp:", error);
            return respondWithError(res, error, "Error creando el checkout onramp");
        }
    },

    purchaseReadiness: async (req, res) => {
        try {
            const result = await getPurchaseOrchestratorReadiness({
                userId: getUserId(req),
                draftId: req.params.draftId,
                walletAddress: req.query?.walletAddress || req.body?.walletAddress || "",
                lotteryAddress: req.query?.lotteryAddress || req.body?.lotteryAddress || "",
                boxQuantity: req.query?.boxQuantity || req.body?.boxQuantity || 0,
            });

            return res.status(200).json({
                ok: true,
                purchaseSession: result.purchaseSession,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
                walletAddress: result.walletAddress,
                readinessSnapshot: result.readinessSnapshot,
                readiness: result.readiness,
                featureFlags: result.featureFlags,
                allowanceState: result.allowanceState || null,
            });
        } catch (error) {
            console.error("Error obteniendo readiness de compra:", error);
            return respondWithError(res, error, "Error obteniendo el estado de compra");
        }
    },

    createDraft: async (req, res) => {
        try {
            const result = await createPurchaseDraft({
                userId: getUserId(req),
                walletAddress: req.body?.walletAddress || "",
                lotteryAddress: req.body?.lotteryAddress || "",
                boxQuantity: req.body?.boxQuantity || 0,
                fundingSessionId: req.body?.fundingSessionId || null,
                paymentIntentId: req.body?.paymentIntentId || null,
            });

            return res.status(201).json({
                ok: true,
                msj: "Draft de compra creado correctamente.",
                purchaseSession: result.purchaseSession,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
                walletAddress: result.walletAddress,
                readinessSnapshot: result.readinessSnapshot,
                readiness: result.readiness,
                fundingPlan: result.fundingPlan,
                walletSnapshot: result.walletSnapshot,
                lotterySnapshot: result.lotterySnapshot,
                allowanceState: result.allowanceState || null,
            });
        } catch (error) {
            console.error("Error creando draft de compra:", error);
            return respondWithError(res, error, "Error creando el draft de compra");
        }
    },

    prepareDraft: async (req, res) => {
        try {
            const result = await preparePurchaseDraft({
                userId: getUserId(req),
                draftId: req.params.draftId,
                walletAddress: req.body?.walletAddress || req.query?.walletAddress || "",
                lotteryAddress: req.body?.lotteryAddress || req.query?.lotteryAddress || "",
                boxQuantity: req.body?.boxQuantity || req.query?.boxQuantity || 0,
            });

            return res.status(200).json({
                ok: true,
                msj: "Draft de compra preparado correctamente.",
                purchaseSession: result.purchaseSession,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
                walletAddress: result.walletAddress,
                readinessSnapshot: result.readinessSnapshot,
                readiness: result.readiness,
                fundingPlan: result.fundingPlan,
                walletSnapshot: result.walletSnapshot,
                lotterySnapshot: result.lotterySnapshot,
                allowanceState: result.allowanceState || null,
            });
        } catch (error) {
            console.error("Error preparando draft de compra:", error);
            return respondWithError(res, error, "Error preparando el draft de compra");
        }
    },

    getDraftStatus: async (req, res) => {
        try {
            const result = await getPurchaseDraftStatus({
                userId: getUserId(req),
                draftId: req.params.draftId,
            });

            return res.status(200).json({
                ok: true,
                purchaseSession: result.purchaseSession,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
                walletAddress: result.walletAddress,
                readinessSnapshot: result.readinessSnapshot,
                readiness: result.readiness,
                featureFlags: result.featureFlags,
                allowanceState: result.allowanceState || null,
            });
        } catch (error) {
            console.error("Error obteniendo estado del draft de compra:", error);
            return respondWithError(res, error, "Error obteniendo el estado del draft");
        }
    },

    finalizeDraft: async (req, res) => {
        try {
            const result = await transitionPurchaseDraft({
                userId: getUserId(req),
                draftId: req.params.draftId,
                status: req.body?.status || req.body?.stage || "",
                txHash: req.body?.txHash || "",
                errorMessage: req.body?.errorMessage || "",
                extra: {
                    ...(req.body?.extra || {}),
                    receiptHash: req.body?.receiptHash || "",
                    boxesSynced: Boolean(req.body?.boxesSynced),
                    syncStatus: req.body?.syncStatus || "",
                },
            });

            return res.status(200).json({
                ok: true,
                msj: "Draft de compra actualizado correctamente.",
                purchaseSession: result.purchaseSession,
                fundingSession: result.fundingSession,
                paymentIntent: result.paymentIntent,
            });
        } catch (error) {
            console.error("Error finalizando draft de compra:", error);
            return respondWithError(res, error, "Error finalizando el draft de compra");
        }
    },

    isEnabled: (req, res) => res.status(200).json({
        ok: true,
        featureFlags: {
            balanceGateEnabled: isBalanceGateEnabled(),
            onrampEnabled: isFundingSessionEnabled(),
            purchaseOrchestratorEnabled: Boolean(resolveRuntimeConfig().featureFlags.purchaseOrchestratorEnabled),
        }
    }),
};

module.exports = paymentsController;
