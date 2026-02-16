const User = require("../../models/user.model");
const Box = require("../../models/oddswin/box.model");


// Agregar Wallet a Usuario
exports.addWallet = async (req, res) => {
    try {
        const { userId, walletAddress } = req.body;
        const normalizedWallet = typeof walletAddress === "string" ? walletAddress.trim().toLowerCase() : "";
        const isAdmin = req.user && req.user.role === "admin";
        const targetUserId = isAdmin && userId ? userId : req.user.id;

        // 1. Validation
        if (!targetUserId || !normalizedWallet) {
            return res.status(400).json({ msj: "Faltan datos obligatorios (walletAddress)" });
        }

        // Validar que la wallet ha comprado boxes (requisito del usuario)
        const hasPurchases = await Box.exists({ owner: normalizedWallet });
        if (!hasPurchases) {
            return res.status(400).json({ msj: "Esta wallet no ha realizado compras de boxes, no se puede vincular." });
        }

        // Evita que una wallet quede ligada a dos cuentas.
        const walletInAnotherUser = await User.findOne({
            wallets: normalizedWallet,
            _id: { $ne: targetUserId }
        }).select("_id");

        if (walletInAnotherUser) {
            return res.status(409).json({ msj: "Esta wallet ya está vinculada a otro usuario" });
        }

        const user = await User.findById(targetUserId);
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        if (user.wallets.includes(normalizedWallet)) {
            return res.status(400).json({ msj: "Wallet ya vinculada" });
        }

        user.wallets.push(normalizedWallet);
        await user.save();

        res.status(200).json({ msj: "Wallet vinculada correctamente", wallets: user.wallets });

    } catch (error) {
        console.error("Error agregando wallet:", error);
        res.status(500).json({ msj: "Error interno agregando wallet" });
    }
}

// Obtener Perfil con Info de Loterías (Aggregation)
exports.getUserProfile = async (req, res) => {
    try {
        const isAdmin = req.user && req.user.role === "admin";
        if (!isAdmin && String(req.user.id) !== String(req.params.id)) {
            return res.status(403).json({ msj: "No tienes permisos para ver este perfil" });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        // Si el usuario tiene wallets vinculadas, buscamos sus compras
        let boxesAcquired = [];
        if (user.wallets && user.wallets.length > 0) {
            // Agregación para obtener: Simbolo, Nombre Loteria, Cantidad Boxes
            boxesAcquired = await Box.aggregate([
                { $match: { owner: { $in: user.wallets } } },
                {
                    $group: {
                        _id: "$direccionLoteria",
                        count: { $sum: 1 }
                    }
                },
                {
                    $lookup: {
                        from: "lotteries", // Nombre de la colección en MongoDB (plural de Lottery)
                        localField: "_id",
                        foreignField: "address",
                        as: "lotteryInfo"
                    }
                },
                {
                    $unwind: "$lotteryInfo"
                },
                {
                    $project: {
                        _id: 0,
                        lotteryName: "$lotteryInfo.name",
                        lotterySymbol: "$lotteryInfo.symbol",
                        lotteryAddress: "$_id",
                        boxesCount: "$count",
                        image: "$lotteryInfo.image"
                    }
                }
            ]);
        }

        res.json({
            _id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            photo: user.photo,
            wallets: user.wallets,
            sponsor: user.sponsor,
            isLoggedIn: user.isLoggedIn,
            boxesAcquired: boxesAcquired
        });

    } catch (error) {
        console.error("Error obteniendo perfil:", error);
        res.status(500).json({ msj: "Error interno obteniendo perfil" });
    }
};
