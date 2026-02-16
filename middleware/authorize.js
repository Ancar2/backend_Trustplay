const User = require("../models/user.model");

const normalizeWallet = (value) => (
    typeof value === "string" ? value.trim().toLowerCase() : ""
);

const isAdmin = (req) => req.user && req.user.role === "admin";

const requireSelfOrAdmin = (paramName = "id") => (req, res, next) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ msj: "Usuario no autenticado" });
    }

    const targetId = String(req.params[paramName] || "");
    if (!targetId) {
        return res.status(400).json({ msj: `Parámetro '${paramName}' inválido` });
    }

    if (isAdmin(req) || String(req.user.id) === targetId) {
        return next();
    }

    return res.status(403).json({ msj: "No tienes permisos para acceder a este recurso" });
};

const getAuthenticatedUserWallets = async (req) => {
    const user = await User.findById(req.user.id).select("wallets");
    if (!user) return null;

    return {
        user,
        wallets: (user.wallets || []).map((wallet) => normalizeWallet(wallet)).filter(Boolean)
    };
};

const getSponsoredWalletsBySponsors = async (sponsorWallets) => {
    if (!Array.isArray(sponsorWallets) || sponsorWallets.length === 0) {
        return [];
    }

    const sponsorSet = new Set(sponsorWallets.map((wallet) => normalizeWallet(wallet)).filter(Boolean));
    if (sponsorSet.size === 0) return [];

    const users = await User.find({
        "sponsorships.sponsor": { $in: [...sponsorSet] }
    }).select("sponsorships");

    const sponsoredWallets = new Set();

    users.forEach((user) => {
        (user.sponsorships || []).forEach((entry) => {
            const sponsor = normalizeWallet(entry?.sponsor);
            const wallet = normalizeWallet(entry?.wallet);

            if (!wallet || !sponsor) return;
            if (sponsorSet.has(sponsor)) {
                sponsoredWallets.add(wallet);
            }
        });
    });

    return [...sponsoredWallets];
};

const requireWalletAccess = (paramName = "wallet") => async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ msj: "Usuario no autenticado" });
        }

        if (isAdmin(req)) {
            return next();
        }

        const targetWallet = normalizeWallet(req.params[paramName]);
        if (!targetWallet) {
            return res.status(400).json({ msj: `Parámetro '${paramName}' inválido` });
        }

        const authState = await getAuthenticatedUserWallets(req);
        if (!authState) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        if (authState.wallets.includes(targetWallet)) {
            return next();
        }

        return res.status(403).json({ msj: "No tienes permisos para acceder a esta wallet" });
    } catch (error) {
        console.error("Error en requireWalletAccess:", error);
        return res.status(500).json({ msj: "Error validando permisos de wallet" });
    }
};

const requireWalletOrReferralAccess = (paramName = "wallet") => async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ msj: "Usuario no autenticado" });
        }

        if (isAdmin(req)) {
            return next();
        }

        const targetWallet = normalizeWallet(req.params[paramName]);
        if (!targetWallet) {
            return res.status(400).json({ msj: `Parámetro '${paramName}' inválido` });
        }

        const authState = await getAuthenticatedUserWallets(req);
        if (!authState) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        // 1) Wallet propia
        if (authState.wallets.includes(targetWallet)) {
            return next();
        }

        // 2) Wallet de referidos directos
        const directWallets = await getSponsoredWalletsBySponsors(authState.wallets);
        if (directWallets.includes(targetWallet)) {
            return next();
        }

        // 3) Wallet de referidos indirectos (nivel 2)
        const indirectWallets = await getSponsoredWalletsBySponsors(directWallets);
        if (indirectWallets.includes(targetWallet)) {
            return next();
        }

        return res.status(403).json({ msj: "No tienes permisos para acceder a esta wallet" });
    } catch (error) {
        console.error("Error en requireWalletOrReferralAccess:", error);
        return res.status(500).json({ msj: "Error validando permisos de referidos" });
    }
};

const requireBodyWalletOwnership = (fieldName = "walletAddress") => async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ msj: "Usuario no autenticado" });
        }

        if (isAdmin(req)) {
            return next();
        }

        const requestedWallet = normalizeWallet(req.body[fieldName]);
        if (!requestedWallet) {
            return res.status(400).json({ msj: `Campo '${fieldName}' inválido` });
        }

        const authState = await getAuthenticatedUserWallets(req);
        if (!authState) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        const tokenWallet = normalizeWallet(req.user.wallet);
        const isOwned = authState.wallets.includes(requestedWallet) || (tokenWallet && tokenWallet === requestedWallet);

        if (!isOwned) {
            return res.status(403).json({ msj: "La wallet no pertenece al usuario autenticado" });
        }

        return next();
    } catch (error) {
        console.error("Error en requireBodyWalletOwnership:", error);
        return res.status(500).json({ msj: "Error validando propiedad de wallet" });
    }
};

module.exports = {
    requireSelfOrAdmin,
    requireWalletAccess,
    requireWalletOrReferralAccess,
    requireBodyWalletOwnership
};
