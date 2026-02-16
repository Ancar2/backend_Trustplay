const mongoose = require("mongoose");

const legalAcceptanceLogSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        username: {
            type: String,
            default: ""
        },
        email: {
            type: String,
            lowercase: true,
            default: "",
            index: true
        },
        wallets: [{
            type: String,
            lowercase: true
        }],
        legalVersion: {
            type: String,
            required: true,
            index: true
        },
        acknowledgements: {
            terms: { type: Boolean, default: false },
            privacy: { type: Boolean, default: false },
            cookies: { type: Boolean, default: false },
            disclaimer: { type: Boolean, default: false }
        },
        acceptedAt: {
            type: Date,
            required: true,
            index: true
        },
        ipAddress: {
            type: String,
            default: ""
        },
        userAgent: {
            type: String,
            default: ""
        },
        source: {
            type: String,
            enum: ["register_form", "social_login", "login_form"],
            required: true
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

legalAcceptanceLogSchema.index({ userId: 1, legalVersion: 1, acceptedAt: -1 });
legalAcceptanceLogSchema.index({ legalVersion: 1, acceptedAt: -1 });

module.exports = mongoose.model("LegalAcceptanceLog", legalAcceptanceLogSchema);

