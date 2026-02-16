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

module.exports = mongoose.model("Box", esquemaBoxes);
