const crypto = require("crypto");
const { ethers } = require("ethers");

const User = require("../../models/user.model");
const WalletIdentity = require("../../models/wallet/walletIdentity.model");
const { isFeatureEnabled } = require("../system/featureFlags.service");
const { createLogger } = require("../system/logger.service");

const logger = createLogger("wallet-identity");
const CHALLENGE_TTL_MINUTES = 10;
const CHALLENGE_TTL_MS = CHALLENGE_TTL_MINUTES * 60 * 1000;

const ALLOWED_PROVIDERS = new Set([
    "legacy",
    "privy",
    "metamask",
    "trustwallet",
    "coinbase",
    "walletconnect",
]);

const normalizeWalletAddress = (value) => (
    typeof value === "string" ? value.trim().toLowerCase() : ""
);

const normalizeWalletProvider = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return "legacy";
    if (normalized === "trust_wallet" || normalized === "trust wallet") return "trustwallet";
    if (normalized === "wallet connect") return "walletconnect";
    if (ALLOWED_PROVIDERS.has(normalized)) return normalized;
    return "legacy";
};

const normalizeWalletType = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "embedded" ? "embedded" : "external";
};

const isWalletIdentityEnabled = () => isFeatureEnabled("walletIdentityEnabled");

const buildChallengeMessage = ({ userId, walletAddress, nonce, expiresAt }) => (
    [
        "TrustPlay wallet ownership verification",
        `UserId: ${String(userId || "").trim()}`,
        `Wallet: ${normalizeWalletAddress(walletAddress)}`,
        `Nonce: ${String(nonce || "").trim()}`,
        `ExpiresAt: ${new Date(expiresAt).toISOString()}`,
        "Purpose: wallet-link",
    ].join("\n")
);

const createChallengeEnvelope = ({ userId, walletAddress }) => {
    const nonce = crypto.randomBytes(24).toString("hex");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const message = buildChallengeMessage({ userId, walletAddress, nonce, expiresAt });

    return {
        nonce,
        issuedAt,
        expiresAt,
        message,
    };
};

const identityToPayload = (identity) => {
    if (!identity) return null;
    return {
        id: identity._id,
        userId: String(identity.userId || ""),
        address: normalizeWalletAddress(identity.address),
        provider: identity.provider || "legacy",
        walletType: identity.walletType || "external",
        isPrimary: Boolean(identity.isPrimary),
        isVerified: Boolean(identity.isVerified),
        linkedAt: identity.linkedAt || null,
        lastUsedAt: identity.lastUsedAt || null,
        status: identity.status || "inactive",
        metadata: identity.metadata || {},
        challengeExpiresAt: identity.challengeExpiresAt || null,
        challengeIssuedAt: identity.challengeIssuedAt || null,
    };
};

const buildUserWalletSnapshot = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        return null;
    }

    const identities = await WalletIdentity.find({ userId: user._id })
        .sort({ isPrimary: -1, linkedAt: 1, createdAt: 1 })
        .lean();

    const legacyWallets = Array.isArray(user.wallets)
        ? [...new Set(user.wallets.map(normalizeWalletAddress).filter(Boolean))]
        : [];

    const primaryIdentity = identities.find((identity) => identity.isPrimary && identity.status === "active" && identity.isVerified)
        || identities.find((identity) => identity.status === "active" && identity.isVerified)
        || null;

    const primaryWallet = normalizeWalletAddress(user.primaryWallet)
        || normalizeWalletAddress(primaryIdentity?.address)
        || legacyWallets[0]
        || null;

    return {
        user,
        legacyWallets,
        primaryWallet,
        wallets: identities.map(identityToPayload),
        migrationVersion: Number(user.walletMigrationVersion || 0),
    };
};

const ensureWalletOnUser = async (user, walletAddress) => {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    if (!normalizedWallet) return false;

    user.wallets = Array.isArray(user.wallets)
        ? [...new Set([...user.wallets.map(normalizeWalletAddress).filter(Boolean), normalizedWallet])]
        : [normalizedWallet];

    if (!user.primaryWallet) {
        user.primaryWallet = normalizedWallet;
    }

    if (!user.walletProvider) {
        user.walletProvider = "legacy";
    }

    user.walletStatus = "active";
    user.walletLinkedAt = user.walletLinkedAt || new Date();
    user.walletMigrationVersion = Math.max(Number(user.walletMigrationVersion || 0), 1);
    await user.save();
    return true;
};

const ensurePrimaryOrderOnUser = async (user, walletAddress) => {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    user.wallets = [
        normalizedWallet,
        ...(Array.isArray(user.wallets)
            ? user.wallets.map(normalizeWalletAddress).filter((wallet) => wallet && wallet !== normalizedWallet)
            : [])
    ];
    user.primaryWallet = normalizedWallet;
    user.walletStatus = "active";
    user.walletLinkedAt = user.walletLinkedAt || new Date();
    user.walletMigrationVersion = Math.max(Number(user.walletMigrationVersion || 0), 1);
    await user.save();
};

const canReassignExistingIdentity = (identity, nextUserId) => (
    Boolean(identity)
    && String(identity.userId) !== String(nextUserId)
    && (
        identity.status !== "active"
        || identity.isVerified !== true
        || Boolean(identity.removedAt)
    )
);

const detachWalletFromPreviousOwner = async (identity, walletAddress) => {
    if (!identity?.userId) return;

    const previousUser = await User.findById(identity.userId);
    if (!previousUser) return null;

    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const sponsorships = Array.isArray(previousUser.sponsorships) ? previousUser.sponsorships : [];
    const walletSponsorship = sponsorships.find((entry) => normalizeWalletAddress(entry?.wallet) === normalizedWallet) || null;

    previousUser.wallets = (Array.isArray(previousUser.wallets) ? previousUser.wallets : [])
        .map(normalizeWalletAddress)
        .filter((wallet) => wallet && wallet !== normalizedWallet);

    previousUser.sponsorships = sponsorships.filter(
        (entry) => normalizeWalletAddress(entry?.wallet) !== normalizedWallet
    );

    if (normalizeWalletAddress(previousUser.primaryWallet) === normalizedWallet) {
        previousUser.primaryWallet = previousUser.wallets[0] || null;
        previousUser.walletProvider = previousUser.primaryWallet ? (previousUser.walletProvider || "legacy") : "legacy";
        previousUser.walletLinkedAt = previousUser.primaryWallet ? (previousUser.walletLinkedAt || new Date()) : null;
        previousUser.walletStatus = previousUser.primaryWallet ? "active" : "inactive";
    }

    await previousUser.save();
    return walletSponsorship;
};

const applyTransferredSponsorshipToUser = async (user, walletAddress, sponsorshipEntry) => {
    if (!user || !sponsorshipEntry) return;

    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const normalizedSponsor = normalizeWalletAddress(sponsorshipEntry?.sponsor);
    if (!normalizedWallet || !normalizedSponsor) return;

    const sponsorships = Array.isArray(user.sponsorships) ? user.sponsorships : [];
    const existingIndex = sponsorships.findIndex(
        (entry) => normalizeWalletAddress(entry?.wallet) === normalizedWallet
    );

    const nextEntry = {
        wallet: normalizedWallet,
        sponsor: normalizedSponsor,
    };

    if (existingIndex >= 0) {
        sponsorships[existingIndex] = nextEntry;
    } else {
        sponsorships.push(nextEntry);
    }

    user.sponsorships = sponsorships;
    if (!normalizeWalletAddress(user.sponsor)) {
        user.sponsor = normalizedSponsor;
    }
    await user.save();
};

const linkLegacyWalletToUser = async ({
    userId,
    walletAddress,
    source = "legacy_add_wallet",
    provider = "legacy",
    metadata = {},
}) => {
    if (!isWalletIdentityEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    const existing = await WalletIdentity.findOne({ address });
    if (existing && String(existing.userId) !== String(user._id) && !canReassignExistingIdentity(existing, user._id)) {
        const error = new Error("WALLET_ALREADY_LINKED");
        error.code = "WALLET_ALREADY_LINKED";
        throw error;
    }

    const transferredSponsorship = canReassignExistingIdentity(existing, user._id)
        ? await detachWalletFromPreviousOwner(existing, address)
        : null;

    const now = new Date();
    const identity = existing || new WalletIdentity({
        userId: user._id,
        address,
    });

    identity.userId = user._id;
    identity.address = address;
    identity.provider = normalizeWalletProvider(provider);
    identity.walletType = "external";
    identity.status = "active";
    identity.isVerified = true;
    identity.isPrimary = Boolean(user.primaryWallet && normalizeWalletAddress(user.primaryWallet) === address) || (!normalizeWalletAddress(user.primaryWallet) && (Array.isArray(user.wallets) ? user.wallets.length === 0 : true));
    identity.source = source;
    identity.linkedAt = identity.linkedAt || now;
    identity.lastUsedAt = now;
    identity.challengeNonce = "";
    identity.challengeMessage = "";
    identity.challengeIssuedAt = null;
    identity.challengeExpiresAt = null;
    identity.challengeUsedAt = now;
    identity.removedAt = null;
    identity.metadata = {
        ...(existing?.metadata || {}),
        ...(metadata || {}),
        linkedVia: source,
        linkedMode: "legacy",
    };

    await identity.save();

    await ensureWalletOnUser(user, address);
    if (transferredSponsorship) {
        await applyTransferredSponsorshipToUser(user, address, transferredSponsorship);
    }
    if (identity.isPrimary) {
        await ensurePrimaryOrderOnUser(user, address);
        user.walletProvider = identity.provider;
        user.walletLinkedAt = user.walletLinkedAt || now;
        user.walletStatus = "active";
        await user.save();
    }

    return {
        user,
        identity,
    };
};

const migrateLegacyWalletsForUser = async (userId) => {
    if (!isWalletIdentityEnabled()) {
        return { migrated: false, skipped: true, reason: "feature_disabled" };
    }

    const user = await User.findById(userId);
    if (!user) {
        return { migrated: false, skipped: true, reason: "user_not_found" };
    }

    const wallets = Array.isArray(user.wallets)
        ? [...new Set(user.wallets.map(normalizeWalletAddress).filter(Boolean))]
        : [];

    if (wallets.length === 0) {
        if (!user.walletStatus || user.walletStatus === "legacy") {
            user.walletStatus = "inactive";
        }
        user.walletMigrationVersion = Math.max(Number(user.walletMigrationVersion || 0), 1);
        await user.save();
        return { migrated: true, walletCount: 0, conflicts: [] };
    }

    const conflicts = [];
    const created = [];

    for (const [index, address] of wallets.entries()) {
        const existing = await WalletIdentity.findOne({ address });

        if (existing && String(existing.userId) !== String(user._id)) {
            conflicts.push(address);
            continue;
        }

        const provider = index === 0 ? "legacy" : (existing?.provider || "legacy");
        const walletType = "external";
        const now = new Date();
        const challengeEnvelope = createChallengeEnvelope({ userId: user._id, walletAddress: address });

        const nextIdentity = existing || new WalletIdentity({
            userId: user._id,
            address,
        });

        nextIdentity.userId = user._id;
        nextIdentity.address = address;
        nextIdentity.provider = provider;
        nextIdentity.walletType = walletType;
        nextIdentity.isPrimary = index === 0;
        nextIdentity.isVerified = true;
        nextIdentity.status = "active";
        nextIdentity.source = "legacy_migration";
        nextIdentity.linkedAt = nextIdentity.linkedAt || now;
        nextIdentity.lastUsedAt = nextIdentity.lastUsedAt || now;
        nextIdentity.challengeNonce = "";
        nextIdentity.challengeMessage = "";
        nextIdentity.challengeIssuedAt = null;
        nextIdentity.challengeExpiresAt = null;
        nextIdentity.challengeUsedAt = now;
        nextIdentity.removedAt = null;
        nextIdentity.metadata = {
            ...(nextIdentity.metadata || {}),
            migratedFrom: "legacy_user_wallets",
            migrationVersion: 1,
            migrationChallengePreview: challengeEnvelope.message,
        };

        await nextIdentity.save();
        created.push(address);
    }

    if (wallets[0]) {
        await ensurePrimaryOrderOnUser(user, wallets[0]);
        user.walletProvider = "legacy";
        user.walletLinkedAt = user.walletLinkedAt || new Date();
        user.walletStatus = "active";
    }

    user.walletMigrationVersion = Math.max(Number(user.walletMigrationVersion || 0), 1);
    await user.save();

    logger.info("legacy_wallets_migrated", {
        userId: String(user._id),
        wallets: created.length,
        conflicts,
    });

    return {
        migrated: true,
        walletCount: created.length,
        conflicts,
    };
};

const migrateLegacyWallets = async () => {
    if (!isWalletIdentityEnabled()) {
        return { migrated: false, skipped: true, reason: "feature_disabled" };
    }

    const users = await User.find({
        $or: [
            { walletMigrationVersion: { $exists: false } },
            { walletMigrationVersion: { $lt: 1 } },
            { primaryWallet: { $in: [null, ""] } },
            { wallets: { $exists: true, $ne: [] } },
        ],
    }).select("_id wallets primaryWallet walletMigrationVersion walletStatus walletProvider walletLinkedAt");

    const summary = {
        usersProcessed: 0,
        identitiesCreated: 0,
        conflicts: 0,
    };

    for (const user of users) {
        const result = await migrateLegacyWalletsForUser(user._id);
        summary.usersProcessed += 1;
        summary.identitiesCreated += Number(result.walletCount || 0);
        summary.conflicts += Array.isArray(result.conflicts) ? result.conflicts.length : 0;
    }

    return { migrated: true, ...summary };
};

const listWalletIdentitiesForUser = async (userId) => {
    const user = await User.findById(userId);
    if (!user) return null;

    const identities = await WalletIdentity.find({ userId: user._id })
        .sort({ isPrimary: -1, linkedAt: 1, createdAt: 1 })
        .lean();

    const legacyWallets = Array.isArray(user.wallets)
        ? [...new Set(user.wallets.map(normalizeWalletAddress).filter(Boolean))]
        : [];

    return {
        user,
        legacyWallets,
        primaryWallet: normalizeWalletAddress(user.primaryWallet) || legacyWallets[0] || null,
        walletMigrationVersion: Number(user.walletMigrationVersion || 0),
        identities: identities.map(identityToPayload),
    };
};

const upsertWalletIdentityLink = async ({
    userId,
    walletAddress,
    provider = "legacy",
    walletType = "external",
    source = "manual_link",
    metadata = {},
}) => {
    if (!isWalletIdentityEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    const normalizedProvider = normalizeWalletProvider(provider);
    const normalizedWalletType = normalizeWalletType(walletType);
    const existing = await WalletIdentity.findOne({ address });

    if (existing && String(existing.userId) !== String(user._id) && !canReassignExistingIdentity(existing, user._id)) {
        const error = new Error("WALLET_ALREADY_LINKED");
        error.code = "WALLET_ALREADY_LINKED";
        throw error;
    }

    const transferredSponsorship = canReassignExistingIdentity(existing, user._id)
        ? await detachWalletFromPreviousOwner(existing, address)
        : null;

    const identity = existing || new WalletIdentity({
        userId: user._id,
        address,
    });

    const challenge = createChallengeEnvelope({ userId: user._id, walletAddress: address });
    identity.userId = user._id;
    identity.address = address;
    identity.provider = normalizedProvider;
    identity.walletType = normalizedWalletType;
    identity.status = "inactive";
    identity.isVerified = Boolean(existing?.isVerified && existing?.status === "active");
    identity.isPrimary = Boolean(existing?.isPrimary);
    identity.source = source;
    identity.metadata = {
        ...(existing?.metadata || {}),
        ...(metadata || {}),
    };
    identity.challengeNonce = challenge.nonce;
    identity.challengeMessage = challenge.message;
    identity.challengeIssuedAt = challenge.issuedAt;
    identity.challengeExpiresAt = challenge.expiresAt;
    identity.challengeUsedAt = null;
    identity.removedAt = null;
    if (!identity.linkedAt) {
        identity.linkedAt = challenge.issuedAt;
    }

    await identity.save();
    if (transferredSponsorship) {
        await applyTransferredSponsorshipToUser(user, address, transferredSponsorship);
    }

    return {
        user,
        identity,
        challenge,
    };
};

const verifyWalletOwnership = async ({
    userId,
    walletAddress,
    signature,
}) => {
    if (!isWalletIdentityEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    if (typeof signature !== "string" || !signature.trim()) {
        throw new Error("INVALID_SIGNATURE");
    }

    const identity = await WalletIdentity.findOne({ userId: user._id, address });
    if (!identity) {
        throw new Error("WALLET_IDENTITY_NOT_FOUND");
    }

    if (!identity.challengeMessage || !identity.challengeNonce) {
        throw new Error("CHALLENGE_NOT_FOUND");
    }

    if (identity.challengeUsedAt) {
        throw new Error("CHALLENGE_ALREADY_USED");
    }

    if (identity.challengeExpiresAt && new Date(identity.challengeExpiresAt).getTime() < Date.now()) {
        identity.status = "inactive";
        await identity.save();
        const error = new Error("CHALLENGE_EXPIRED");
        error.code = "CHALLENGE_EXPIRED";
        throw error;
    }

    const recovered = ethers.verifyMessage(identity.challengeMessage, signature.trim());
    if (normalizeWalletAddress(recovered) !== address) {
        throw new Error("SIGNATURE_DOES_NOT_MATCH_WALLET");
    }

    const now = new Date();
    identity.isVerified = true;
    identity.status = "active";
    identity.challengeUsedAt = now;
    identity.challengeMessage = "";
    identity.challengeNonce = "";
    identity.challengeIssuedAt = null;
    identity.challengeExpiresAt = null;
    identity.lastUsedAt = now;
    identity.linkedAt = identity.linkedAt || now;
    identity.removedAt = null;
    identity.metadata = {
        ...(identity.metadata || {}),
        verifiedAt: now.toISOString(),
        verifiedVia: "signature",
    };

    await identity.save();

    await ensureWalletOnUser(user, address);

    if (!normalizeWalletAddress(user.primaryWallet)) {
        user.primaryWallet = address;
        user.walletProvider = identity.provider;
        user.walletLinkedAt = user.walletLinkedAt || now;
        user.walletStatus = "active";
        await user.save();
    }

    if (normalizeWalletAddress(user.primaryWallet) === address) {
        await setPrimaryWallet({
            userId: user._id,
            walletAddress: address,
            skipVerificationCheck: true,
        });
    }

    const snapshot = await listWalletIdentitiesForUser(user._id);

    logger.info("wallet_verified", {
        userId: String(user._id),
        address,
        provider: identity.provider,
    });

    return {
        user,
        identity: identityToPayload(identity),
        snapshot,
    };
};

const setPrimaryWallet = async ({
    userId,
    walletAddress,
    skipVerificationCheck = false,
}) => {
    if (!isWalletIdentityEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    const identity = await WalletIdentity.findOne({ userId: user._id, address });
    if (!identity) {
        throw new Error("WALLET_IDENTITY_NOT_FOUND");
    }

    if (!skipVerificationCheck && (!identity.isVerified || identity.status !== "active")) {
        throw new Error("WALLET_NOT_VERIFIED");
    }

    await WalletIdentity.updateMany(
        { userId: user._id },
        { $set: { isPrimary: false } }
    );

    identity.isPrimary = true;
    identity.status = "active";
    identity.isVerified = true;
    identity.lastUsedAt = new Date();
    identity.linkedAt = identity.linkedAt || new Date();
    await identity.save();

    await ensurePrimaryOrderOnUser(user, address);
    user.walletProvider = identity.provider;
    user.walletLinkedAt = user.walletLinkedAt || new Date();
    user.walletStatus = "active";
    await user.save();

    logger.info("wallet_primary_updated", {
        userId: String(user._id),
        address,
    });

    return {
        user,
        identity: identityToPayload(identity),
        snapshot: await listWalletIdentitiesForUser(user._id),
    };
};

const removeWalletIdentity = async ({ userId, walletAddress }) => {
    if (!isWalletIdentityEnabled()) {
        return { ok: false, disabled: true };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    const address = normalizeWalletAddress(walletAddress);
    if (!address) {
        throw new Error("INVALID_WALLET_ADDRESS");
    }

    const identity = await WalletIdentity.findOne({ userId: user._id, address });
    if (!identity) {
        throw new Error("WALLET_IDENTITY_NOT_FOUND");
    }

    identity.status = "inactive";
    identity.isVerified = false;
    identity.isPrimary = false;
    identity.challengeNonce = "";
    identity.challengeMessage = "";
    identity.challengeIssuedAt = null;
    identity.challengeExpiresAt = null;
    identity.challengeUsedAt = null;
    identity.removedAt = new Date();
    identity.metadata = {
        ...(identity.metadata || {}),
        removedAt: new Date().toISOString(),
    };
    await identity.save();

    user.wallets = (Array.isArray(user.wallets) ? user.wallets : [])
        .map(normalizeWalletAddress)
        .filter((wallet) => wallet && wallet !== address);

    if (normalizeWalletAddress(user.primaryWallet) === address) {
        const nextPrimary = await WalletIdentity.findOne({
            userId: user._id,
            status: "active",
            isVerified: true,
            address: { $ne: address },
        }).sort({ isPrimary: -1, linkedAt: 1, createdAt: 1 });

        if (nextPrimary) {
            user.primaryWallet = normalizeWalletAddress(nextPrimary.address);
            user.walletProvider = nextPrimary.provider;
            user.walletLinkedAt = nextPrimary.linkedAt || nextPrimary.createdAt || new Date();
            user.walletStatus = "active";
            await WalletIdentity.updateMany(
                { userId: user._id },
                { $set: { isPrimary: false } }
            );
            nextPrimary.isPrimary = true;
            await nextPrimary.save();
        } else {
            user.primaryWallet = user.wallets[0] || null;
            user.walletProvider = user.primaryWallet ? "legacy" : "legacy";
            user.walletLinkedAt = user.primaryWallet ? new Date() : null;
            user.walletStatus = user.primaryWallet ? "active" : "inactive";
        }
    }

    await user.save();

    logger.info("wallet_removed", {
        userId: String(user._id),
        address,
    });

    return {
        user,
        identity: identityToPayload(identity),
        snapshot: await listWalletIdentitiesForUser(user._id),
    };
};

module.exports = {
    ALLOWED_PROVIDERS: [...ALLOWED_PROVIDERS],
    CHALLENGE_TTL_MS,
    buildChallengeMessage,
    buildUserWalletSnapshot,
    createChallengeEnvelope,
    identityToPayload,
    isWalletIdentityEnabled,
    listWalletIdentitiesForUser,
    linkLegacyWalletToUser,
    migrateLegacyWallets,
    migrateLegacyWalletsForUser,
    normalizeWalletAddress,
    normalizeWalletProvider,
    normalizeWalletType,
    removeWalletIdentity,
    setPrimaryWallet,
    upsertWalletIdentityLink,
    verifyWalletOwnership,
};
