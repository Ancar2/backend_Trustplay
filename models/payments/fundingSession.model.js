const mongoose = require("mongoose");

const fundingSessionSchema = new mongoose.Schema(
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
        purchaseSessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseSession",
            default: null,
            index: true,
        },
        paymentIntentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PaymentIntent",
            default: null,
            index: true,
        },
        provider: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["created", "awaiting_payment", "submitted", "confirmed", "balance_verified", "ready", "expired", "failed", "cancelled"],
            default: "created",
            index: true,
        },
        requiredUsdt: {
            type: Number,
            default: 0,
            min: 0,
        },
        requiredPol: {
            type: Number,
            default: 0,
            min: 0,
        },
        minPolBalanceTarget: {
            type: Number,
            default: 3,
            min: 0,
        },
        currentUsdtBalance: {
            type: Number,
            default: 0,
            min: 0,
        },
        currentPolBalance: {
            type: Number,
            default: 0,
            min: 0,
        },
        providerReference: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },
        providerPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        balanceSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        webhookVerifiedAt: {
            type: Date,
            default: null,
        },
        balanceVerifiedAt: {
            type: Date,
            default: null,
        },
        readyForPurchaseAt: {
            type: Date,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true,
        },
        notes: {
            type: String,
            default: "",
            trim: true,
        },
    },
    {
        timestamps: true,
        collection: "funding_sessions",
    }
);

fundingSessionSchema.index({ userId: 1, status: 1 });
fundingSessionSchema.index({ walletAddress: 1, status: 1 });

module.exports = mongoose.model("FundingSession", fundingSessionSchema);
