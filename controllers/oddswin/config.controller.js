const GlobalConfig = require('../../models/oddswin/globalConfig.model');

const getEnvAddress = (key) => String(process.env[key] || "").trim();

// Valores iniciales al crear GlobalConfig si no existe documento.
// Se priorizan variables de entorno para evitar arrastrar direcciones antiguas hardcodeadas.
const DEFAULTS = {
    sponsors: getEnvAddress("DEFAULT_SPONSORS_ADDRESS"),
    middleware: getEnvAddress("DEFAULT_MIDDLEWARE_ADDRESS"),
    factory: getEnvAddress("DEFAULT_FACTORY_ADDRESS"),
    exclusiveNFT: getEnvAddress("DEFAULT_EXCLUSIVE_NFT_ADDRESS"),
    usdt: getEnvAddress("DEFAULT_USDT_ADDRESS"),
    owner: getEnvAddress("DEFAULT_FACTORY_OWNER")
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
