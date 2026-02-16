const mongoose = require("mongoose");

const esquemaLoteria = new mongoose.Schema(
    {
        address: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
        },
        creationHash: {
            type: String, // Hash de la transacción de creación (Factory.createLottery)
        },
        year: {
            type: Number,
            required: true,
            index: true,
        },
        index: {
            type: Number,
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        symbol: {
            type: String,
            required: true,
        },
        totalBoxes: {
            type: Number,
            required: true,
        },
        boxPrice: {
            type: Number,
            required: true,
        },
        stableCoin: {
            type: String,
            required: true,
            lowercase: true,
        },
        percentageWinner: {
            type: Number,
            required: true,
        },
        percentageSponsorWinner: {
            type: Number,
            required: true,
        },
        percentageMostReferrals: { // incentivePercentMaxSponsors
            type: Number,
            required: true,
        },
        percentageExclusiveNft: {
            type: Number,
            default: 0
        },
        exclusiveNftRewardPool: {
            type: Number,
            default: 0
        },
        incentiveMaxBuyer: {
            boxes1: Number,
            percentage1: Number,
            boxes2: Number,
            percentage2: Number,
            boxes3: Number,
            percentage3: Number
        },
        boxesSold: {
            type: Number,
            default: 0,
        },
        totalParticipants: {
            type: Number,
            default: 0
        },
        totalRaised: {
            type: Number,
            default: 0
        },
        winningNumber: {
            type: Number,
            default: 0,
        },
        setWinnerTxHash: {
            type: String,
            default: "",
            lowercase: true,
        },
        completed: {
            type: Boolean,
            default: false,
        },
        // Ganadores y Premios (Se llenan al finalizar)
        winnerAddress: { type: String, lowercase: true, default: null },
        winnerPrize: { type: Number, default: 0 },

        winnerSponsor: { type: String, lowercase: true, default: null },
        sponsorPrize: { type: Number, default: 0 },

        winnerTopBuyer: { type: String, lowercase: true, default: null },
        topBuyerBoxes: { type: Number, default: 0 },
        topBuyerPrize: { type: Number, default: 0 },

        winnerMostReferrals: { type: String, lowercase: true, default: null },
        mostReferralsPrize: { type: Number, default: 0 },

        owner: {
            type: String, // Address of the Lottery owner/creator
            lowercase: true,
        },
        status: {
            type: String,
            enum: ["Pending", "Active", "Completed"],
            default: "Active",
        },
        // Metadata
        description: {
            type: String,
            default: "",
        },
        image: {
            type: String,
            default: "",
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        drawEvent: {
            announced: {
                type: Boolean,
                default: false,
            },
            scheduledAt: {
                type: Date,
                default: null,
            },
            announcedAt: {
                type: Date,
                default: null,
            },
            announcedBy: {
                type: String,
                default: "",
            },
            timezone: {
                type: String,
                default: "America/Bogota",
            },
            videoId: {
                type: String,
                default: "",
            },
            videoTitle: {
                type: String,
                default: "",
            },
            videoEmbedUrl: {
                type: String,
                default: "",
            },
            videoDetectedAt: {
                type: Date,
                default: null,
            },
            resultLocked: {
                type: Boolean,
                default: false,
            },
            resultLockedAt: {
                type: Date,
                default: null,
            },
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Lottery", esquemaLoteria);
