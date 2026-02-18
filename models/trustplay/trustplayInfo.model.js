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
        // TrustplayInfo solo conserva metadatos institucionales no legales.
        // La fuente de verdad legal es /api/legal/*.
        social: { type: [footerLinkSchema], default: [] }
    },
    {
        timestamps: true,
        collection: 'trustplay_info'
    }
);

module.exports = mongoose.model('TrustplayInfo', trustplayInfoSchema);
