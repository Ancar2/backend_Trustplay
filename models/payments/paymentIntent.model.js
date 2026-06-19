const mongoose = require("mongoose");

const paymentIntentSchema = new mongoose.Schema(
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
        fundingSessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FundingSession",
            default: null,
            index: true,
        },
        provider: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        providerOrderId: {
            type: String,
            default: undefined,
            trim: true,
            index: true,
        },
        fiatCurrency: {
            type: String,
            default: "cop",
            lowercase: true,
            trim: true,
            index: true,
        },
        fiatAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        targetAsset: {
            type: String,
            default: "usdt",
            lowercase: true,
            trim: true,
        },
        targetChain: {
            type: String,
            default: "eip155:137",
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["draft", "open", "submitted", "confirmed", "failed", "cancelled", "expired"],
            default: "draft",
            index: true,
        },
        providerStatus: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },
        providerPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "payment_intents",
    }
);

paymentIntentSchema.index({ provider: 1, providerOrderId: 1 }, { unique: true, sparse: true });
paymentIntentSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("PaymentIntent", paymentIntentSchema);
