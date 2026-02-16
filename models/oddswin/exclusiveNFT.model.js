const mongoose = require('mongoose');

const exclusiveSchema = new mongoose.Schema({
    tokenId: {
        type: Number,
        required: true,
        index: true // Removed unique: true to allow ownership history
    },
    owner: {
        type: String,
        required: true,
        index: true,
        lowercase: true
    },
    metadata: {
        type: Object,
        default: {}
    },
    pendingRewards: {
        type: String,
        default: "0"
    },
    totalRegalias: {
        type: Number,
        default: 0
    },
    timeRemainingSeconds: {
        type: Number,
        default: 0
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

exclusiveSchema.index({ tokenId: 1, owner: 1 });

module.exports = mongoose.model('ExclusiveNFT', exclusiveSchema);
