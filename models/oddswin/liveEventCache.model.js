const mongoose = require("mongoose");

const liveEventCacheSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        payload: {
            type: Object,
            default: {},
        },
        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("LiveEventCache", liveEventCacheSchema);
