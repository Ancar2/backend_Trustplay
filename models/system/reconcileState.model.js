const mongoose = require("mongoose");

const reconcileStateSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        lastProcessedBlock: {
            type: Number,
            default: 0
        },
        isRunning: {
            type: Boolean,
            default: false
        },
        cancelRequested: {
            type: Boolean,
            default: false
        },
        cancelRequestedAt: {
            type: Date,
            default: null
        },
        lockUntil: {
            type: Date,
            default: null
        },
        lastRunAt: {
            type: Date,
            default: null
        },
        lastSuccessAt: {
            type: Date,
            default: null
        },
        lastError: {
            type: String,
            default: ""
        },
        lastReport: {
            type: Object,
            default: {}
        }
    },
    {
        timestamps: true,
        collection: "reconcile_state"
    }
);

module.exports = mongoose.model("ReconcileState", reconcileStateSchema);
