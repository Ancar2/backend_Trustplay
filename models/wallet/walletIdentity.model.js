const mongoose = require("mongoose");

const walletIdentitySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        address: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        provider: {
            type: String,
            enum: ["legacy", "privy", "metamask", "trustwallet", "coinbase", "walletconnect"],
            default: "legacy",
            index: true,
        },
        walletType: {
            type: String,
            enum: ["embedded", "external"],
            default: "external",
            index: true,
        },
        isPrimary: {
            type: Boolean,
            default: false,
            index: true,
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ["active", "inactive", "blocked"],
            default: "inactive",
            index: true,
        },
        source: {
            type: String,
            default: "existing_user",
            trim: true,
        },
        externalId: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        challengeNonce: {
            type: String,
            default: "",
        },
        challengeMessage: {
            type: String,
            default: "",
        },
        challengeIssuedAt: {
            type: Date,
            default: null,
        },
        challengeExpiresAt: {
            type: Date,
            default: null,
        },
        challengeUsedAt: {
            type: Date,
            default: null,
        },
        linkedAt: {
            type: Date,
            default: null,
        },
        lastUsedAt: {
            type: Date,
            default: null,
        },
        removedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: "wallet_identities",
    }
);

walletIdentitySchema.index({ address: 1 }, { unique: true });
walletIdentitySchema.index({ userId: 1, isPrimary: 1 });
walletIdentitySchema.index({ userId: 1, provider: 1 });
walletIdentitySchema.index({ userId: 1, status: 1 });
walletIdentitySchema.index({ challengeNonce: 1 }, { sparse: true });

module.exports = mongoose.model("WalletIdentity", walletIdentitySchema);
