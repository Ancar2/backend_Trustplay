const mongoose = require("mongoose");

const statusClaimReconcileLogSchema = new mongoose.Schema(
    {
        claimKey: {
            type: String,
            required: true,
            unique: true
        },
        contractType: {
            type: String,
            required: true,
            enum: ["prime", "founding"],
            index: true
        },
        contractAddress: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        owner: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },
        tokenId: {
            type: Number,
            required: true,
            min: 1,
            index: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        blockNumber: {
            type: Number,
            required: true,
            min: 0
        },
        txHash: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        logIndex: {
            type: Number,
            required: true,
            min: 0
        },
        claimTime: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

statusClaimReconcileLogSchema.index({ contractType: 1, owner: 1, tokenId: 1 });
statusClaimReconcileLogSchema.index({ blockNumber: -1 });

module.exports = mongoose.model("StatusClaimReconcileLog", statusClaimReconcileLogSchema);
