const TRUE_VALUES = new Set(["true", "1", "yes", "si", "on"]);

const normalizeString = (value) => String(value ?? "").trim();

const parseBoolean = (value, fallback = false) => {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return fallback;
    return TRUE_VALUES.has(normalized);
};

const parseCsv = (value) => (
    normalizeString(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
);

const parseNumber = (value, fallback = 0) => {
    const parsed = Number(normalizeString(value));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOnrampEnvironment = (value, fallback = "sandbox") => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === "production") return "production";
    if (normalized === "sandbox") return "sandbox";
    return fallback;
};

const resolveDefaultOnrampEnvironment = () => (
    normalizeString(process.env.NODE_ENV).toLowerCase() === "production"
        ? "production"
        : "sandbox"
);

const readEnvConfig = () => ({
    featureFlags: {
        walletIdentityEnabled: parseBoolean(process.env.FEATURE_WALLET_IDENTITY_ENABLED, false),
        privyEmbeddedWalletsEnabled: parseBoolean(process.env.FEATURE_PRIVY_ENABLED, false),
        externalWalletsEnabled: parseBoolean(process.env.FEATURE_EXTERNAL_WALLETS_ENABLED, true),
        onrampEnabled: parseBoolean(process.env.ONRAMP, parseBoolean(process.env.FEATURE_ONRAMP_ENABLED, false)),
        balanceGateEnabled: parseBoolean(process.env.FEATURE_BALANCE_GATE_ENABLED, false),
        purchaseOrchestratorEnabled: parseBoolean(process.env.FEATURE_PURCHASE_ORCHESTRATOR_ENABLED, false),
        observabilityEnabled: parseBoolean(process.env.FEATURE_OBSERVABILITY_ENABLED, true),
    },
    integrations: {
        privy: {
            enabled: parseBoolean(process.env.FEATURE_PRIVY_ENABLED, false),
            appId: normalizeString(process.env.PRIVY_APP_ID),
            appSecret: normalizeString(process.env.PRIVY_APP_SECRET),
            frontendAppId: normalizeString(process.env.PRIVY_FRONTEND_APP_ID),
            clientId: normalizeString(process.env.PRIVY_FRONTEND_CLIENT_ID || process.env.PRIVY_CLIENT_ID),
            walletType: normalizeString(process.env.PRIVY_WALLET_TYPE) || "embedded",
            gasTokenPaymentsEnabled: parseBoolean(process.env.PRIVY_GAS_TOKEN_PAYMENTS_ENABLED, false),
        },
        metaPixel: {
            enabled: parseBoolean(process.env.META_PIXEL_ENABLED, false),
            pixelId: normalizeString(process.env.META_PIXEL_ID),
        },
        onramp: {
            enabled: parseBoolean(process.env.ONRAMP, parseBoolean(process.env.FEATURE_ONRAMP_ENABLED, false)),
            provider: normalizeString(process.env.ONRAMP_PROVIDER) || "privy",
            method: normalizeString(process.env.ONRAMP_METHOD) || "moonpay",
            environment: parseOnrampEnvironment(process.env.ONRAMP_ENV, resolveDefaultOnrampEnvironment()),
            defaultFiatCurrency: normalizeString(process.env.ONRAMP_DEFAULT_FIAT_CURRENCY) || "cop",
            targetChain: normalizeString(process.env.ONRAMP_TARGET_CHAIN) || "eip155:137",
            supportedFiatCurrencies: parseCsv(process.env.ONRAMP_SUPPORTED_FIAT_CURRENCIES),
            supportedAssets: parseCsv(process.env.ONRAMP_SUPPORTED_ASSETS),
            minFiatAmountUsd: parseNumber(process.env.ONRAMP_MIN_FIAT_AMOUNT_USD, 20),
            estimatedFeeUsd: parseNumber(process.env.ONRAMP_ESTIMATED_FEE_USD, 3),
            polBuffer: parseNumber(process.env.ONRAMP_POL_BUFFER, 2),
            tokenAddress: normalizeString(process.env.ONRAMP_TOKEN_ADDRESS),
            tokenSymbol: normalizeString(process.env.ONRAMP_TOKEN_SYMBOL),
            referrerDomain: normalizeString(process.env.ONRAMP_REFERRER_DOMAIN),
        },
    },
    purchase: {
        minPolBalance: parseNumber(process.env.MIN_POL_BALANCE, 1),
    },
    observability: {
        requestLoggingEnabled: parseBoolean(process.env.REQUEST_LOGGING_ENABLED, true),
        logLevel: normalizeString(process.env.LOG_LEVEL) || "info",
        requestIdHeader: normalizeString(process.env.REQUEST_ID_HEADER) || "x-trustplay-request-id",
    }
});

const resolveFeatureFlags = () => readEnvConfig().featureFlags;

const resolveRuntimeConfig = () => readEnvConfig();

const isFeatureEnabled = (flagName) => {
    const flags = resolveFeatureFlags();
    return Boolean(flags?.[flagName]);
};

module.exports = {
    resolveFeatureFlags,
    resolveRuntimeConfig,
    isFeatureEnabled,
    parseBoolean,
    parseCsv,
    parseNumber,
    parseOnrampEnvironment,
    normalizeString,
};
