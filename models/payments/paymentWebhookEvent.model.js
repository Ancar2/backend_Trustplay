const mongoose = require("mongoose");

const paymentWebhookEventSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        eventId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["received", "verified", "processed", "ignored_duplicate", "rejected_signature", "failed"],
            default: "received",
            index: true,
        },
        signatureValid: {
            type: Boolean,
            default: false,
            index: true,
        },
        walletAddress: {
            type: String,
            default: "",
            lowercase: true,
            trim: true,
            index: true,
        },
        providerReference: {
            type: String,
            default: "",
            trim: true,
            index: true,
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
        purchaseSessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PurchaseSession",
            default: null,
            index: true,
        },
        rawPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        processedPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        receivedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        processedAt: {
            type: Date,
            default: null,
        },
        errorMessage: {
            type: String,
            default: "",
            trim: true,
        },
    },
    {
        timestamps: true,
        collection: "payment_webhook_events",
    }
);

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
