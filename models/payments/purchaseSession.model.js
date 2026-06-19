const mongoose = require("mongoose");

const purchaseSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        walletAddress: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        lotteryAddress: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        boxQuantity: {
            type: Number,
            required: true,
            min: 1,
        },
        expectedUsdt: {
            type: Number,
            default: 0,
            min: 0,
        },
        expectedPol: {
            type: Number,
            default: 0,
            min: 0,
        },
        fundingSessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FundingSession",
            default: null,
            index: true,
        },
        paymentIntentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PaymentIntent",
            default: null,
            index: true,
        },
        txHash: {
            type: String,
            default: "",
            lowercase: true,
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: [
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
                "synced",
                "completed",
                "failed",
                "cancelled",
                "expired",
            ],
            default: "created",
            index: true,
        },
        readinessSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        purchaseRequestPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        errorMessage: {
            type: String,
            default: "",
            trim: true,
        },
        readyForPurchaseAt: {
            type: Date,
            default: null,
        },
        submittedAt: {
            type: Date,
            default: null,
        },
        confirmedAt: {
            type: Date,
            default: null,
        },
        syncedAt: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "purchase_sessions",
    }
);

purchaseSessionSchema.index({ userId: 1, status: 1 });
purchaseSessionSchema.index({ walletAddress: 1, lotteryAddress: 1 });
purchaseSessionSchema.index({ userId: 1, walletAddress: 1, lotteryAddress: 1, boxQuantity: 1, status: 1 });

module.exports = mongoose.model("PurchaseSession", purchaseSessionSchema);
