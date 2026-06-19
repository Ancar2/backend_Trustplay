const GlobalConfig = require('../../models/oddswin/globalConfig.model');
const { resolveRuntimeConfig } = require('../../services/system/featureFlags.service');

const getEnvAddress = (key) => String(process.env[key] || "").trim();
const getRuntimeConfig = () => resolveRuntimeConfig();

const normalizeString = (value) => String(value || "").trim();

const buildPublicRuntimeSlices = () => {
    const runtimeConfig = getRuntimeConfig();
    const privyFrontendAppId = normalizeString(
        runtimeConfig?.integrations?.privy?.frontendAppId
        || runtimeConfig?.integrations?.privy?.appId
    );
    const privyClientId = normalizeString(runtimeConfig?.integrations?.privy?.clientId);

    return {
        featureFlags: {
            ...(runtimeConfig?.featureFlags || {})
        },
        integrations: {
            privy: {
                enabled: Boolean(runtimeConfig?.integrations?.privy?.enabled),
                appId: privyFrontendAppId,
                frontendAppId: privyFrontendAppId,
                clientId: privyClientId,
                walletType: normalizeString(runtimeConfig?.integrations?.privy?.walletType) || 'embedded',
                gasTokenPaymentsEnabled: Boolean(runtimeConfig?.integrations?.privy?.gasTokenPaymentsEnabled),
            },
            metaPixel: {
                enabled: Boolean(runtimeConfig?.integrations?.metaPixel?.enabled),
                pixelId: normalizeString(runtimeConfig?.integrations?.metaPixel?.pixelId),
            },
            onramp: {
                enabled: Boolean(runtimeConfig?.integrations?.onramp?.enabled),
                provider: normalizeString(runtimeConfig?.integrations?.onramp?.provider) || 'privy',
                method: normalizeString(runtimeConfig?.integrations?.onramp?.method) || 'moonpay',
                environment: normalizeString(runtimeConfig?.integrations?.onramp?.environment) || 'sandbox',
                defaultFiatCurrency: normalizeString(runtimeConfig?.integrations?.onramp?.defaultFiatCurrency) || 'cop',
                targetChain: normalizeString(runtimeConfig?.integrations?.onramp?.targetChain) || 'eip155:137',
                supportedFiatCurrencies: Array.isArray(runtimeConfig?.integrations?.onramp?.supportedFiatCurrencies)
                    ? runtimeConfig.integrations.onramp.supportedFiatCurrencies
                    : [],
                supportedAssets: Array.isArray(runtimeConfig?.integrations?.onramp?.supportedAssets)
                    ? runtimeConfig.integrations.onramp.supportedAssets
                    : [],
                minFiatAmountUsd: Number(runtimeConfig?.integrations?.onramp?.minFiatAmountUsd || 20),
                estimatedFeeUsd: Number(runtimeConfig?.integrations?.onramp?.estimatedFeeUsd || 3),
                polBuffer: Number(runtimeConfig?.integrations?.onramp?.polBuffer || 2),
                tokenAddress: normalizeString(runtimeConfig?.integrations?.onramp?.tokenAddress),
                tokenSymbol: normalizeString(runtimeConfig?.integrations?.onramp?.tokenSymbol),
                referrerDomain: normalizeString(runtimeConfig?.integrations?.onramp?.referrerDomain),
            },
        },
        observability: {
            ...(runtimeConfig?.observability || {})
        }
    };
};

const PUBLIC_RUNTIME_DEFAULTS = buildPublicRuntimeSlices();

// Valores iniciales al crear GlobalConfig si no existe documento.
// Se priorizan variables de entorno para evitar arrastrar direcciones antiguas hardcodeadas.
const DEFAULTS = {
    sponsors: getEnvAddress("DEFAULT_SPONSORS_ADDRESS"),
    middleware: getEnvAddress("DEFAULT_MIDDLEWARE_ADDRESS"),
    factory: getEnvAddress("DEFAULT_FACTORY_ADDRESS"),
    exclusiveNFT: getEnvAddress("DEFAULT_EXCLUSIVE_NFT_ADDRESS"),
    foundingCircle: getEnvAddress("DEFAULT_FOUNDING_CIRCLE_ADDRESS"),
    usdt: getEnvAddress("DEFAULT_USDT_ADDRESS"),
    owner: getEnvAddress("DEFAULT_FACTORY_OWNER"),
    featureFlags: PUBLIC_RUNTIME_DEFAULTS.featureFlags,
    integrations: PUBLIC_RUNTIME_DEFAULTS.integrations,
    observability: PUBLIC_RUNTIME_DEFAULTS.observability,
};

const ensureFeatureFlagsDefaults = (featureFlags = {}) => ({
    ...DEFAULTS.featureFlags,
    ...featureFlags,
});

const ensureObservabilityDefaults = (observability = {}) => ({
    ...DEFAULTS.observability,
    ...observability,
});

const ensureIntegrationsDefaults = (integrations = {}) => ({
    ...DEFAULTS.integrations,
    ...integrations,
    privy: {
        ...DEFAULTS.integrations.privy,
        ...(integrations?.privy || {}),
    },
    onramp: {
        ...DEFAULTS.integrations.onramp,
        ...(integrations?.onramp || {}),
    },
    metaPixel: {
        ...DEFAULTS.integrations.metaPixel,
        ...(integrations?.metaPixel || {}),
    },
});

const sanitizePublicIntegrations = (integrations = {}) => ({
    ...integrations,
    privy: {
        enabled: Boolean(integrations?.privy?.enabled),
        appId: normalizeString(integrations?.privy?.appId),
        frontendAppId: normalizeString(integrations?.privy?.frontendAppId),
        clientId: normalizeString(integrations?.privy?.clientId),
        walletType: normalizeString(integrations?.privy?.walletType) || 'embedded',
        gasTokenPaymentsEnabled: Boolean(integrations?.privy?.gasTokenPaymentsEnabled),
    },
    metaPixel: {
        enabled: Boolean(integrations?.metaPixel?.enabled),
        pixelId: normalizeString(integrations?.metaPixel?.pixelId),
    },
    onramp: {
        enabled: Boolean(integrations?.onramp?.enabled),
        provider: normalizeString(integrations?.onramp?.provider) || 'privy',
        method: normalizeString(integrations?.onramp?.method) || 'moonpay',
        environment: normalizeString(integrations?.onramp?.environment) || 'sandbox',
        defaultFiatCurrency: normalizeString(integrations?.onramp?.defaultFiatCurrency) || 'cop',
        targetChain: normalizeString(integrations?.onramp?.targetChain) || 'eip155:137',
        supportedFiatCurrencies: Array.isArray(integrations?.onramp?.supportedFiatCurrencies)
            ? integrations.onramp.supportedFiatCurrencies
            : [],
        supportedAssets: Array.isArray(integrations?.onramp?.supportedAssets)
            ? integrations.onramp.supportedAssets
            : [],
        minFiatAmountUsd: Number(integrations?.onramp?.minFiatAmountUsd || 20),
        estimatedFeeUsd: Number(integrations?.onramp?.estimatedFeeUsd || 3),
        polBuffer: Number(integrations?.onramp?.polBuffer || 2),
        tokenAddress: normalizeString(integrations?.onramp?.tokenAddress),
        tokenSymbol: normalizeString(integrations?.onramp?.tokenSymbol),
        referrerDomain: normalizeString(integrations?.onramp?.referrerDomain),
    },
});

const mergeConfig = (current = {}, patch = {}) => {
    const next = { ...current };

    Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined) return;

        if (value && typeof value === "object" && !Array.isArray(value)) {
            next[key] = {
                ...(current?.[key] || {}),
                ...value
            };
            return;
        }

        next[key] = value;
    });

    return next;
};

const buildPublicConfigResponse = (configDocument) => {
    const runtimeSlices = buildPublicRuntimeSlices();
    const persisted = typeof configDocument?.toObject === "function"
        ? configDocument.toObject()
        : (configDocument || {});
    const persistedIntegrations = ensureIntegrationsDefaults(persisted.integrations || {});
    const mergedIntegrations = sanitizePublicIntegrations({
        ...persistedIntegrations,
        ...runtimeSlices.integrations,
        privy: {
            ...persistedIntegrations.privy,
            ...runtimeSlices.integrations.privy,
        },
        metaPixel: {
            ...persistedIntegrations.metaPixel,
            ...runtimeSlices.integrations.metaPixel,
        },
        onramp: {
            ...persistedIntegrations.onramp,
            ...runtimeSlices.integrations.onramp,
        },
    });

    return {
        ...persisted,
        featureFlags: runtimeSlices.featureFlags,
        integrations: mergedIntegrations,
        observability: runtimeSlices.observability,
    };
};

const configController = {
    getConfig: async (req, res) => {
        try {
            let config = await GlobalConfig.findOne();

            if (!config) {
                // If no config exists, create it with defaults
                config = new GlobalConfig(DEFAULTS);
                await config.save();
            } else if (!config.owner || typeof config.foundingCircle === "undefined" || typeof config.featureFlags === "undefined") {
                // Migration: asegurar campos nuevos en docs existentes.
                if (!config.owner) config.owner = DEFAULTS.owner || '';
                if (typeof config.foundingCircle === "undefined") {
                    config.foundingCircle = DEFAULTS.foundingCircle || '';
                }
                if (typeof config.featureFlags === "undefined") {
                    config.featureFlags = DEFAULTS.featureFlags;
                } else {
                    config.featureFlags = ensureFeatureFlagsDefaults(config.featureFlags || {});
                }
                if (typeof config.integrations === "undefined") {
                    config.integrations = DEFAULTS.integrations;
                } else {
                    config.integrations = ensureIntegrationsDefaults(config.integrations || {});
                }
                if (typeof config.observability === "undefined") {
                    config.observability = DEFAULTS.observability;
                } else {
                    config.observability = ensureObservabilityDefaults(config.observability || {});
                }
                await config.save();
            }

            return res.status(200).json({
                ok: true,
                config: buildPublicConfigResponse(config)
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
            const {
                sponsors,
                middleware,
                factory,
                exclusiveNFT,
                foundingCircle,
                usdt,
                owner,
                featureFlags,
                integrations,
                observability
            } = req.body;

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
            if (foundingCircle) config.foundingCircle = foundingCircle;
            if (usdt) config.usdt = usdt;
            if (owner) config.owner = owner;
            if (typeof featureFlags !== "undefined") {
                config.featureFlags = mergeConfig(ensureFeatureFlagsDefaults(config.featureFlags || {}), featureFlags || {});
            }
            if (typeof integrations !== "undefined") {
                const currentIntegrations = config.integrations || {};
                config.integrations = mergeConfig(currentIntegrations, integrations || {});
            }
            if (typeof observability !== "undefined") {
                config.observability = mergeConfig(config.observability || {}, observability || {});
            }

            config.updatedAt = Date.now();
            await config.save();

            return res.status(200).json({
                ok: true,
                msg: 'Configuration updated successfully',
                config: buildPublicConfigResponse(config)
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
