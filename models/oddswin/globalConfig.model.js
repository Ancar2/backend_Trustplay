const mongoose = require('mongoose');
const { Schema } = mongoose;

const featureFlagsSchema = new Schema(
    {
        walletIdentityEnabled: { type: Boolean, default: false },
        privyEmbeddedWalletsEnabled: { type: Boolean, default: false },
        externalWalletsEnabled: { type: Boolean, default: true },
        balanceGateEnabled: { type: Boolean, default: false },
        purchaseOrchestratorEnabled: { type: Boolean, default: false },
        observabilityEnabled: { type: Boolean, default: true },
    },
    { _id: false }
);

const privyConfigSchema = new Schema(
    {
        enabled: { type: Boolean, default: false },
        appId: { type: String, default: '' },
        appSecret: { type: String, default: '', select: false },
        frontendAppId: { type: String, default: '' },
        clientId: { type: String, default: '' },
        walletType: { type: String, default: 'embedded' },
        gasTokenPaymentsEnabled: { type: Boolean, default: false }
    },
    { _id: false }
);

const onrampConfigSchema = new Schema(
    {
        enabled: { type: Boolean, default: false },
        provider: { type: String, default: 'privy' },
        method: { type: String, default: 'moonpay' },
        environment: { type: String, default: 'sandbox' },
        defaultFiatCurrency: { type: String, default: 'cop' },
        targetChain: { type: String, default: 'eip155:137' },
        supportedFiatCurrencies: { type: [String], default: [] },
        supportedAssets: { type: [String], default: [] },
        minFiatAmountUsd: { type: Number, default: 20 },
        estimatedFeeUsd: { type: Number, default: 3 },
        polBuffer: { type: Number, default: 2 },
        tokenAddress: { type: String, default: '' },
        tokenSymbol: { type: String, default: '' },
        referrerDomain: { type: String, default: '' }
    },
    { _id: false }
);

const metaPixelConfigSchema = new Schema(
    {
        enabled: { type: Boolean, default: false },
        pixelId: { type: String, default: '' }
    },
    { _id: false }
);

const observabilitySchema = new Schema(
    {
        requestLoggingEnabled: { type: Boolean, default: true },
        logLevel: { type: String, default: 'info' },
        requestIdHeader: { type: String, default: 'x-trustplay-request-id' }
    },
    { _id: false }
);

const globalConfigSchema = new Schema({
    sponsors: { type: String, default: '' },
    middleware: { type: String, default: '' },
    factory: { type: String, default: '' },
    exclusiveNFT: { type: String, default: '' },
    foundingCircle: { type: String, default: '' },
    usdt: { type: String, default: '' },
    owner: { type: String, default: '' }, // Owner Address (Factory Owner)
    featureFlags: { type: featureFlagsSchema, default: () => ({}) },
    integrations: {
        privy: { type: privyConfigSchema, default: () => ({}) },
        onramp: { type: onrampConfigSchema, default: () => ({}) },
        metaPixel: { type: metaPixelConfigSchema, default: () => ({}) },
    },
    observability: { type: observabilitySchema, default: () => ({}) },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);
