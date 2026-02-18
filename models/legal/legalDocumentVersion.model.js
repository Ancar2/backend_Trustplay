const mongoose = require("mongoose");

const legalDocumentVersionSchema = new mongoose.Schema(
    {
        documentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LegalDocument",
            required: true,
            index: true
        },
        version: {
            type: String,
            required: true,
            trim: true
        },
        locale: {
            type: String,
            default: "es-CO",
            trim: true
        },
        publishedAt: {
            type: Date,
            default: null
        },
        effectiveAt: {
            type: Date,
            required: true,
            index: true
        },
        contentUrl: {
            type: String,
            default: "",
            trim: true
        },
        contentHtml: {
            type: String,
            default: ""
        },
        sha256: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        changeSummary: {
            type: String,
            default: "",
            trim: true
        },
        isPublished: {
            type: Boolean,
            default: false,
            index: true
        },
        createdBy: {
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null
            },
            email: {
                type: String,
                default: "",
                trim: true,
                lowercase: true
            }
        }
    },
    {
        timestamps: true,
        collection: "legal_document_versions",
        versionKey: false
    }
);

legalDocumentVersionSchema.index({ documentId: 1, version: 1 }, { unique: true });
legalDocumentVersionSchema.index({ documentId: 1, isPublished: 1, effectiveAt: -1 });

module.exports = mongoose.model("LegalDocumentVersion", legalDocumentVersionSchema);
