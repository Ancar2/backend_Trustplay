const User = require("../../models/user.model");

// Obtener Estadísticas de Usuarios (Dashboard Admin)
exports.getUserStats = async (req, res) => {
    try {
        // 1. Total Usuarios
        const totalUsers = await User.countDocuments();

        // 2. Usuarios Registrados Hoy
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const todayUsers = await User.countDocuments({
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        });

        res.status(200).json({
            totalUsers,
            todayUsers
        });

    } catch (error) {
        res.status(500).json({ msj: "Error obteniendo estadísticas", error: error.message });
    }
};


// Obtener Estadísticas de Sponsor (Rendimiento para Admin)
exports.getSponsorStats = async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const address = walletAddress.toLowerCase();

        // 1. Total Referidos (Usuarios que tienen a esta wallet como sponsor)
        const referralsCount = await User.countDocuments({ sponsor: address });

        // 2. Buscar Upline Directo e Indirecto
        // Primero buscamos al usuario dueño de esta wallet
        const user = await User.findOne({ wallets: address });

        let uplineDirect = null;
        let uplineIndirect = null;

        if (user && user.sponsor) {
            uplineDirect = user.sponsor;

            // Para buscar el indirecto (abuelo), buscamos al usuario dueño del direct (padre)
            const parentUser = await User.findOne({ wallets: uplineDirect });
            if (parentUser && parentUser.sponsor) {
                uplineIndirect = parentUser.sponsor;
            }
        }

        res.status(200).json({
            sponsorAddress: address,
            referrals: referralsCount,
            uplineDirect: uplineDirect || "N/A",
            uplineIndirect: uplineIndirect || "N/A"
        });

    } catch (error) {
        console.error("Error getSponsorStats:", error);
        res.status(500).json({ msj: "Error interno obteniendo estadísticas de sponsor" });
    }
};


// Obtener Todos los Usuarios con Estadísticas de Cajas (Admin)
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.aggregate([
            // 1. Unwind wallets array to handle each wallet individually (optimization)
            // Note: If users have many wallets, this might duplicate user rows securely to join, 
            // but we group later.
            // Actually, better approach: Loopup boxes where owner IN wallets.

            {
                $lookup: {
                    from: "boxes",
                    let: { userWallets: "$wallets" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $in: ["$owner", "$$userWallets"] }
                            }
                        },
                        // Group boxes by lottery address internal to user
                        {
                            $group: {
                                _id: "$direccionLoteria",
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    as: "boxStatsRaw"
                }
            },

            // Lookup Lottery details for each boxStat to get the Symbol
            {
                $unwind: {
                    path: "$boxStatsRaw",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: "lotteries",
                    localField: "boxStatsRaw._id",
                    foreignField: "address",
                    as: "lotteryDetails"
                }
            },
            {
                $unwind: {
                    path: "$lotteryDetails",
                    preserveNullAndEmptyArrays: true // If box exists but lottery deleted/not found
                }
            },

            // Re-Group back to User
            {
                $group: {
                    _id: "$_id",
                    username: { $first: "$username" },
                    email: { $first: "$email" },
                    photo: { $first: "$photo" },
                    wallets: { $first: "$wallets" },
                    isActive: { $first: "$isActive" },
                    createdAt: { $first: "$createdAt" },
                    // Reconstruct the stats array
                    stats: {
                        $push: {
                            $cond: {
                                if: { $not: ["$boxStatsRaw"] },
                                then: "$$REMOVE", // Don't push if null
                                else: {
                                    lotteryAddress: "$boxStatsRaw._id",
                                    count: "$boxStatsRaw.count",
                                    symbol: { $ifNull: ["$lotteryDetails.symbol", "UNKNOWN"] }
                                }
                            }
                        }
                    }
                }
            },

            // Optional: Sort by creation date desc
            { $sort: { createdAt: -1 } }
        ]);

        res.status(200).json({ users });

    } catch (error) {
        console.error("Error getAllUsers:", error);
        res.status(500).json({ msj: "Error obteniendo lista de usuarios", error: error.message });
    }
};
