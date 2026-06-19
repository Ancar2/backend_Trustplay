const User = require("../../models/user.model");
const {
    isWalletIdentityEnabled,
    listWalletIdentitiesForUser,
    migrateLegacyWalletsForUser,
    removeWalletIdentity,
    setPrimaryWallet,
    upsertWalletIdentityLink,
    verifyWalletOwnership,
    normalizeWalletAddress,
    normalizeWalletProvider,
    normalizeWalletType,
    identityToPayload,
} = require("../../services/wallets/walletIdentity.service");

const buildFeatureDisabledResponse = (res) => (
    res.status(403).json({ msj: "La administración de identidad de wallets está deshabilitada." })
);

const mapWalletSnapshot = (snapshot) => ({
    primaryWallet: snapshot?.primaryWallet || null,
    legacyWallets: snapshot?.legacyWallets || [],
    walletMigrationVersion: snapshot?.walletMigrationVersion || 0,
    wallets: snapshot?.identities || [],
    hasPrimaryWallet: Boolean(snapshot?.primaryWallet),
});

const getWallets = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            const user = await (req.user?.id
                ? User.findById(req.user.id).select("wallets primaryWallet walletProvider walletLinkedAt walletStatus walletMigrationVersion")
                : null);
            if (!user) {
                return res.status(404).json({ msj: "Usuario no encontrado" });
            }
            return res.status(200).json({
                primaryWallet: user.primaryWallet || user.wallets?.[0] || null,
                legacyWallets: Array.isArray(user.wallets) ? user.wallets : [],
                walletMigrationVersion: Number(user.walletMigrationVersion || 0),
                wallets: [],
                hasPrimaryWallet: Boolean(user.primaryWallet || (Array.isArray(user.wallets) && user.wallets.length > 0)),
                featureEnabled: false,
            });
        }

        const userId = req.user?.id;
        const snapshot = await listWalletIdentitiesForUser(userId);
        if (!snapshot) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        return res.status(200).json({
            ok: true,
            featureEnabled: true,
            ...mapWalletSnapshot(snapshot),
        });
    } catch (error) {
        console.error("Error obteniendo wallets del usuario:", error);
        return res.status(500).json({ msj: "Error obteniendo wallets del usuario" });
    }
};

const linkWallet = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            return buildFeatureDisabledResponse(res);
        }

        const userId = req.user?.id;
        const walletAddress = normalizeWalletAddress(req.body?.walletAddress);
        const provider = normalizeWalletProvider(req.body?.provider);
        const walletType = normalizeWalletType(req.body?.walletType);

        const result = await upsertWalletIdentityLink({
            userId,
            walletAddress,
            provider,
            walletType,
            source: "manual_link",
            metadata: {
                source: "wallet_link_endpoint",
                linkedFrom: String(req.headers["user-agent"] || "").slice(0, 180),
            },
        });

        if (result?.disabled) {
            return buildFeatureDisabledResponse(res);
        }

        return res.status(200).json({
            ok: true,
            wallet: identityToPayload(result.identity),
            challenge: {
                message: result.challenge.message,
                nonce: result.challenge.nonce,
                issuedAt: result.challenge.issuedAt,
                expiresAt: result.challenge.expiresAt,
            },
        });
    } catch (error) {
        if (error?.code === "WALLET_ALREADY_LINKED") {
            return res.status(409).json({ msj: "Esta wallet ya está vinculada a otro usuario." });
        }
        if (error?.message === "INVALID_WALLET_ADDRESS") {
            return res.status(400).json({ msj: "Wallet inválida." });
        }
        if (error?.message === "USER_NOT_FOUND") {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        console.error("Error vinculando wallet:", error);
        return res.status(500).json({ msj: "Error vinculando wallet" });
    }
};

const setPrimary = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            return buildFeatureDisabledResponse(res);
        }

        const result = await setPrimaryWallet({
            userId: req.user?.id,
            walletAddress: req.body?.walletAddress,
        });

        if (result?.disabled) {
            return buildFeatureDisabledResponse(res);
        }

        return res.status(200).json({
            ok: true,
            wallet: result.identity,
            wallets: result.snapshot?.identities || [],
            primaryWallet: result.snapshot?.primaryWallet || null,
        });
    } catch (error) {
        if (error?.message === "WALLET_NOT_VERIFIED") {
            return res.status(409).json({ msj: "La wallet debe verificarse antes de marcarla como principal." });
        }
        if (error?.message === "WALLET_IDENTITY_NOT_FOUND") {
            return res.status(404).json({ msj: "La wallet no está vinculada." });
        }
        if (error?.message === "INVALID_WALLET_ADDRESS") {
            return res.status(400).json({ msj: "Wallet inválida." });
        }
        console.error("Error actualizando wallet principal:", error);
        return res.status(500).json({ msj: "Error actualizando wallet principal" });
    }
};

const verifyOwnership = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            return buildFeatureDisabledResponse(res);
        }

        const result = await verifyWalletOwnership({
            userId: req.user?.id,
            walletAddress: req.body?.walletAddress,
            signature: req.body?.signature,
        });

        if (result?.disabled) {
            return buildFeatureDisabledResponse(res);
        }

        return res.status(200).json({
            ok: true,
            wallet: result.identity,
            wallets: result.snapshot?.identities || [],
            primaryWallet: result.snapshot?.primaryWallet || null,
            legacyWallets: result.snapshot?.legacyWallets || [],
        });
    } catch (error) {
        if (error?.message === "USER_NOT_FOUND") {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }
        if (error?.message === "INVALID_WALLET_ADDRESS") {
            return res.status(400).json({ msj: "Wallet inválida." });
        }
        if (error?.message === "INVALID_SIGNATURE") {
            return res.status(400).json({ msj: "Firma inválida." });
        }
        if (error?.message === "WALLET_IDENTITY_NOT_FOUND") {
            return res.status(404).json({ msj: "La wallet no está vinculada." });
        }
        if (error?.message === "CHALLENGE_NOT_FOUND") {
            return res.status(404).json({ msj: "No existe un challenge activo para esta wallet." });
        }
        if (error?.message === "CHALLENGE_ALREADY_USED") {
            return res.status(409).json({ msj: "El challenge ya fue utilizado." });
        }
        if (error?.message === "CHALLENGE_EXPIRED") {
            return res.status(410).json({ msj: "El challenge expiró. Solicita uno nuevo." });
        }
        if (error?.message === "SIGNATURE_DOES_NOT_MATCH_WALLET") {
            return res.status(400).json({ msj: "La firma no corresponde a la wallet indicada." });
        }

        console.error("Error verificando ownership de wallet:", error);
        return res.status(500).json({ msj: "Error verificando ownership de wallet" });
    }
};

const removeWallet = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            const userId = req.user.id;
            const walletToRemove = normalizeWalletAddress(req.params.wallet);

            if (!walletToRemove) {
                return res.status(400).json({ msj: "Wallet inválida" });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ msj: "Usuario no encontrado" });
            }

            const walletIndex = user.wallets.findIndex((wallet) => normalizeWalletAddress(wallet) === walletToRemove);
            if (walletIndex === -1) {
                return res.status(404).json({ msj: "La wallet no está vinculada a esta cuenta" });
            }

            user.wallets.splice(walletIndex, 1);
            await user.save();

            return res.status(200).json({
                ok: true,
                msj: "Wallet desvinculada correctamente",
                wallets: user.wallets,
            });
        }

        const result = await removeWalletIdentity({
            userId: req.user?.id,
            walletAddress: req.params?.wallet,
        });

        if (result?.disabled) {
            return buildFeatureDisabledResponse(res);
        }

        return res.status(200).json({
            ok: true,
            wallet: result.identity,
            wallets: result.snapshot?.identities || [],
            primaryWallet: result.snapshot?.primaryWallet || null,
            legacyWallets: result.snapshot?.legacyWallets || [],
        });
    } catch (error) {
        if (error?.message === "USER_NOT_FOUND") {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }
        if (error?.message === "INVALID_WALLET_ADDRESS") {
            return res.status(400).json({ msj: "Wallet inválida." });
        }
        if (error?.message === "WALLET_IDENTITY_NOT_FOUND") {
            return res.status(404).json({ msj: "La wallet no está vinculada." });
        }
        console.error("Error desvinculando wallet:", error);
        return res.status(500).json({ msj: "Error desvinculando wallet" });
    }
};

const migrateWallets = async (req, res) => {
    try {
        if (!isWalletIdentityEnabled()) {
            return buildFeatureDisabledResponse(res);
        }

        const result = await migrateLegacyWalletsForUser(req.user?.id);
        return res.status(200).json({
            ok: true,
            ...result,
        });
    } catch (error) {
        console.error("Error migrando wallets legacy:", error);
        return res.status(500).json({ msj: "Error migrando wallets" });
    }
};

module.exports = {
    getWallets,
    linkWallet,
    migrateWallets,
    removeWallet,
    setPrimary,
    verifyOwnership,
};
