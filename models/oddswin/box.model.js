const mongoose = require("mongoose");

const esquemaBoxes = new mongoose.Schema(
    {
        direccionLoteria: {
            type: String,
            required: true,
            index: true,
            lowercase: true,
        },
        boxId: {
            type: Number,
            required: true,
        },
        owner: {
            type: String,
            required: true,
            index: true,
            lowercase: true,
        },
        buyer: {
            type: String,
            default: "",
            index: true,
            lowercase: true,
        },
        ownerCurrent: {
            type: String,
            default: "",
            index: true,
            lowercase: true,
        },
        ownerCurrentUpdatedAt: {
            type: Date,
            default: null,
        },
        ownerCurrentTxHash: {
            type: String,
            default: "",
            trim: true,
        },
        ticket1: {
            type: Number,
        },
        ticket2: {
            type: Number,
        },
        fechaDeCompra: {
            type: Date,
            default: Date.now,
        },
        hashDeLaTransaccion: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Index compuesto para asegurar unicidad de boxId dentro de una lottery
esquemaBoxes.index({ direccionLoteria: 1, boxId: 1 }, { unique: true });

esquemaBoxes.pre("validate", function () {
    const normalizedOwner = typeof this.owner === "string" ? this.owner.trim().toLowerCase() : "";
    if (normalizedOwner) {
        this.owner = normalizedOwner;
        if (!this.buyer) this.buyer = normalizedOwner;
        if (!this.ownerCurrent) this.ownerCurrent = normalizedOwner;
    }
});

module.exports = mongoose.model("Box", esquemaBoxes);
