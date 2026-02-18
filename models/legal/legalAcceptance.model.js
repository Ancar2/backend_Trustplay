const mongoose = require("mongoose");

const legalAcceptanceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        documentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LegalDocument",
            required: true,
            index: true
        },
        documentKey: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },
        versionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LegalDocumentVersion",
            required: true,
            index: true
        },
        version: {
            type: String,
            required: true,
            trim: true
        },
        sha256: {
            type: String,
            required: true,
            trim: true
        },
        acceptedAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true
        },
        ip: {
            type: String,
            default: ""
        },
        userAgent: {
            type: String,
            default: ""
        },
        source: {
            type: String,
            default: "legal_center",
            trim: true
        }
    },
    {
        timestamps: true,
        collection: "legal_acceptances",
        versionKey: false
    }
);

legalAcceptanceSchema.index({ userId: 1, documentKey: 1, versionId: 1 }, { unique: true });
legalAcceptanceSchema.index({ userId: 1, acceptedAt: -1 });

module.exports = mongoose.model("LegalAcceptance", legalAcceptanceSchema);
