const mongoose = require("mongoose");

const legalDocumentSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: ["active", "archived"],
            default: "active"
        },
        currentVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LegalDocumentVersion",
            default: null
        }
    },
    {
        timestamps: true,
        collection: "legal_documents",
        versionKey: false
    }
);

legalDocumentSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model("LegalDocument", legalDocumentSchema);
