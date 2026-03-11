const mongoose = require('mongoose');

const foundingCircleSchema = new mongoose.Schema({
    tokenId: {
        type: Number,
        required: true,
        index: true
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

foundingCircleSchema.index({ tokenId: 1, owner: 1 });

module.exports = mongoose.model('FoundingCircle', foundingCircleSchema);
