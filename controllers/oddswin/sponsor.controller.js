const User = require("../../models/user.model");
const Box = require("../../models/oddswin/box.model");

// Obtener Actividad de mis Referidos (Para el usuario sponsor)
exports.getReferralsActivity = async (req, res) => {
    try {
        const { userId } = req.params;
        const isAdmin = req.user && req.user.role === "admin";
        if (!isAdmin && String(req.user.id) !== String(userId)) {
            return res.status(403).json({ msj: "No tienes permisos para ver esta actividad" });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        // Si el usuario no tiene wallets vinculadas que funcionen como sponsor, retornamos vacio
        let myWallets = user.wallets || [];

        if (myWallets.length === 0) {
            return res.status(200).json([]);
        }

        // 1. Encontrar usuarios que me tienen como sponsor
        const referrals = await User.find({ sponsor: { $in: myWallets } }).select("username wallets photo");

        if (referrals.length === 0) {
            return res.status(200).json([]);
        }

        // 2. Para cada referido, buscar sus compras
        let activity = [];

        for (const ref of referrals) {
            if (ref.wallets && ref.wallets.length > 0) {
                const purchases = await Box.aggregate([
                    { $match: { owner: { $in: ref.wallets } } },
                    {
                        $lookup: {
                            from: "lotteries",
                            localField: "direccionLoteria",
                            foreignField: "address",
                            as: "lotteryInfo"
                        }
                    },
                    { $unwind: "$lotteryInfo" },
                    {
                        $project: {
                            _id: 0,
                            lotteryName: "$lotteryInfo.name",
                            lotterySymbol: "$lotteryInfo.symbol",
                            boxesCount: 1,
                            hash: "$hashDeLaTransaccion",
                            fechaDeCompra: 1,
                            boxId: 1,
                            ticket1: 1,
                            ticket2: 1
                        }
                    },
                    // Agrupar por transacción (hash) para mostrar resumen "Compró X boxes en Lottery Y"
                    {
                        $group: {
                            _id: "$hash",
                            lotteryName: { $first: "$lotteryName" },
                            lotterySymbol: { $first: "$lotterySymbol" },
                            boxesCount: { $sum: 1 },
                            date: { $first: "$fechaDeCompra" },
                            boxes: {
                                $push: {
                                    boxId: "$boxId",
                                    ticket1: "$ticket1",
                                    ticket2: "$ticket2"
                                }
                            }
                        }
                    },
                    { $sort: { date: -1 } }
                ]);

                if (purchases.length > 0) {
                    activity.push({
                        referral: {
                            username: ref.username,
                            photo: ref.photo,
                            wallets: ref.wallets
                        },
                        purchases: purchases
                    });
                }
            }
        }

        res.status(200).json(activity);

    } catch (error) {
        console.error("Error getting referral activity:", error);
        res.status(500).json({ msj: "Error obteniendo actividad de referidos", error: error.message });
    }
};
