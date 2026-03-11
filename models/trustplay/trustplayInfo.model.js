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

const shareRoomSchema = new Schema(
    {
        slug: { type: String, required: true, trim: true, lowercase: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        imageUrl: { type: String, required: true, trim: true },
        roomUrl: { type: String, required: true, trim: true },
        platform: { type: String, enum: ["meet", "zoom", "other"], default: "other" },
        active: { type: Boolean, default: true },
        order: { type: Number, default: 0 }
    },
    { timestamps: true }
);

const userGuideSchema = new Schema(
    {
        fileName: { type: String, required: true, trim: true },
        mimeType: { type: String, required: true, trim: true, default: "application/pdf" },
        sizeBytes: { type: Number, required: true, min: 1 },
        uploadedAt: { type: Date, required: true },
        uploadedById: { type: String, default: "", trim: true },
        uploadedByUsername: { type: String, default: "", trim: true },
        data: { type: Buffer, required: true, select: false },
    },
    { _id: false }
);

const trustplayInfoSchema = new Schema(
    {
        // TrustplayInfo solo conserva metadatos institucionales no legales.
        // La fuente de verdad legal es /api/legal/*.
        social: { type: [footerLinkSchema], default: [] },
        shareRooms: { type: [shareRoomSchema], default: [] },
        userGuide: { type: userGuideSchema, default: null }
    },
    {
        timestamps: true,
        collection: 'trustplay_info'
    }
);

module.exports = mongoose.model('TrustplayInfo', trustplayInfoSchema);
