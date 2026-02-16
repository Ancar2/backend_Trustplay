const mongoose = require('mongoose');
const { Schema } = mongoose;

const footerLinkSchema = new Schema(
    {
        label: { type: String, required: true, trim: true },
        url: { type: String, default: '#', trim: true },
        content: { type: String, default: '' },
        active: { type: Boolean, default: true },
        order: { type: Number, default: 0 }
    },
    { _id: false }
);

const trustplayInfoSchema = new Schema(
    {
        legalVersion: { type: String, default: 'LEGAL-TP-2026-02', trim: true },
        legalUpdatedAt: { type: Date, default: Date.now },
        legal: { type: [footerLinkSchema], default: [] },
        social: { type: [footerLinkSchema], default: [] }
    },
    {
        timestamps: true,
        collection: 'trustplay_info'
    }
);

module.exports = mongoose.model('TrustplayInfo', trustplayInfoSchema);
