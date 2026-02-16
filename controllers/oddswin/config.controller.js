const GlobalConfig = require('../../models/oddswin/globalConfig.model');

// Predefined defaults (current values) to seed if empty
const DEFAULTS = {
    sponsors: '0xb7c637417455D64EC5eE24657E293BBfaAde1dA9',
    middleware: '0xDeb0f7Bf3860411AC0F870566Bd32239F72F72Cc',
    factory: '0xeC0c20136BfaB92f495Ae1A46f1094d90E2c4D62',
    exclusiveNFT: '0xf9a6ACbC87667418085e4396E66F24D720B4cbc8',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // Placeholder (Hardhat Default) or actual Factory Owner
};

const configController = {
    getConfig: async (req, res) => {
        try {
            let config = await GlobalConfig.findOne();

            if (!config) {
                // If no config exists, create it with defaults
                config = new GlobalConfig(DEFAULTS);
                await config.save();
            } else if (!config.owner) {
                // Migration: If owner is missing but doc exists, add default owner
                config.owner = DEFAULTS.owner || '';
                await config.save();
            }

            return res.status(200).json({
                ok: true,
                config
            });
        } catch (error) {
            console.error("Error fetching configuration:", error);
            return res.status(500).json({
                ok: false,
                msg: 'Error fetching configuration'
            });
        }
    },

    updateConfig: async (req, res) => {
        try {
            const { sponsors, middleware, factory, exclusiveNFT, usdt, owner } = req.body;

            // Upsert: Find and update, or create if not found
            // Since we expect only one doc, we can findOneAndUpdate a loose query or just findOne
            // Ideally we use findOne() then update properties

            let config = await GlobalConfig.findOne();
            if (!config) {
                config = new GlobalConfig();
            }

            if (sponsors) config.sponsors = sponsors;
            if (middleware) config.middleware = middleware;
            if (factory) config.factory = factory;
            if (exclusiveNFT) config.exclusiveNFT = exclusiveNFT;
            if (usdt) config.usdt = usdt;
            if (owner) config.owner = owner;

            config.updatedAt = Date.now();
            await config.save();

            return res.status(200).json({
                ok: true,
                msg: 'Configuration updated successfully',
                config
            });

        } catch (error) {
            console.error("Error updating configuration:", error);
            return res.status(500).json({
                ok: false,
                msg: 'Error updating configuration'
            });
        }
    }
};

module.exports = configController;
