const User = require("../../models/user.model");
const {
    syncPrivyWalletIdentity,
    isPrivyEnabled,
    buildPrivyJwks,
} = require("../../services/wallets/privy.service");

const buildFeatureDisabledResponse = (res) => (
    res.status(403).json({ msj: "Privy está deshabilitado en este entorno." })
);

const syncWallet = async (req, res) => {
    try {
        if (!isPrivyEnabled()) {
            return buildFeatureDisabledResponse(res);
        }

        const result = await syncPrivyWalletIdentity({
            userId: req.user?.id,
            walletAddress: req.body?.walletAddress,
            privyWalletId: req.body?.privyWalletId,
            metadata: req.body?.metadata || {},
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
        if (error?.message === "WALLET_ALREADY_LINKED") {
            return res.status(409).json({ msj: "Esta wallet ya está vinculada a otro usuario." });
        }

        console.error("Error sincronizando wallet Privy:", error);
        return res.status(500).json({ msj: "Error sincronizando wallet Privy" });
    }
};

const getJwks = async (req, res) => {
    try {
        const jwks = buildPrivyJwks();
        return res.status(200).json(jwks);
    } catch (error) {
        if (error?.message === "PRIVY_JWKS_NOT_CONFIGURED") {
            return res.status(404).json({
                title: "JWKS not configured",
                detail: "Configura PRIVY_JWT_PRIVATE_KEY y la clave publica/certificado antes de exponer el JWKS.",
                status: 404,
            });
        }

        console.error("Error generando JWKS de Privy:", error);
        return res.status(500).json({ msj: "Error generando JWKS de Privy" });
    }
};

module.exports = {
    getJwks,
    syncWallet,
};
