const Box = require("../../models/oddswin/box.model");
const Lottery = require("../../models/oddswin/lottery.model");
const User = require("../../models/user.model");

const normalizeWallet = (value) => (
    typeof value === "string" ? value.trim().toLowerCase() : ""
);

// Registrar la compra de una Box en la base de datos de ODDSWIN
// Esto se llamaría después de que el frontend confirme la transacción en blockchain
exports.registerBoxPurchase = async (req, res) => {
    try {
        const {
            lotteryAddress,
            boxId,
            owner,
            ticket1,
            ticket2,
            transactionHash,
            sponsor // Optional
        } = req.body;
        const normalizedLotteryAddress = normalizeWallet(lotteryAddress);
        const normalizedOwner = normalizeWallet(owner);

        // 1. Validation
        if (!normalizedLotteryAddress || !boxId || !normalizedOwner || !transactionHash) {
            return res.status(400).json({ msj: "Faltan datos obligatorios para registrar la compra" });
        }

        // 1.1 Security: El owner de la compra debe pertenecer al usuario autenticado.
        const authUser = await User.findById(req.user.id).select("wallets");
        if (!authUser) {
            return res.status(404).json({ msj: "Usuario autenticado no encontrado" });
        }

        const userWallets = (authUser.wallets || []).map(normalizeWallet).filter(Boolean);
        const tokenWallet = normalizeWallet(req.user.wallet);
        const walletBelongsToUser = userWallets.includes(normalizedOwner) || (tokenWallet && tokenWallet === normalizedOwner);

        if (!walletBelongsToUser) {
            return res.status(403).json({ msj: "No tienes permiso para registrar compras con esta wallet" });
        }

        // Fallback para usuarios legacy: si la wallet vino por token y no estaba ligada, la ligamos.
        if (!userWallets.includes(normalizedOwner)) {
            await User.updateOne(
                { _id: authUser._id, wallets: { $ne: normalizedOwner } },
                { $push: { wallets: normalizedOwner } }
            );
        }

        // 1.2 La lotería debe existir.
        const lottery = await Lottery.findOne({ address: normalizedLotteryAddress });
        if (!lottery) {
            return res.status(404).json({ msj: "Lotería no encontrada" });
        }

        // Comprobamos si esta Box ya fue registrada
        const existingBox = await Box.findOne({
            direccionLoteria: normalizedLotteryAddress,
            boxId: boxId
        });

        if (existingBox) {
            return res.status(400).json({ msj: "Esta Box ya ha sido registrada previamente en ODDSWIN" });
        }

        // Creamos el registro de la Box
        const newBox = new Box({
            direccionLoteria: normalizedLotteryAddress,
            boxId,
            owner: normalizedOwner,
            ticket1,
            ticket2,
            hashDeLaTransaccion: transactionHash
        });

        // Guardamos la box
        await newBox.save();

        // ---------------------------------------------------------
        // LOGICA DE SPONSOR: Guardar sponsor en usuario si es la primera vez
        // ---------------------------------------------------------
        // ---------------------------------------------------------
        // LOGICA DE SPONSOR: Guardar sponsor en usuario si es la primera vez
        // ---------------------------------------------------------
        // const { sponsor } = req.body; // YA DEFINIDO ARRIBA
        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
        const normalizedSponsor = normalizeWallet(sponsor);

        // Solo intentamos guardar si viene un sponsor válido (no nulo, no cero)
        if (normalizedSponsor && normalizedSponsor !== ZERO_ADDRESS) {
            // Buscamos al usuario dueño de esta wallet
            const userOwner = await User.findOne({
                wallets: normalizedOwner
            });

            if (userOwner) {
                // Verificar si YA existe un registro de sponsor para ESTA wallet específica
                // Usamos updateOne atómico con filtro de no-existencia para evitar Race Conditions (duplicados)
                await User.updateOne(
                    {
                        _id: userOwner._id,
                        "sponsorships.wallet": { $ne: normalizedOwner }
                    },
                    {
                        $push: {
                            sponsorships: {
                                wallet: normalizedOwner,
                                sponsor: normalizedSponsor
                            }
                        }
                    }
                );

                // Mantenemos retro-compatibilidad: Si el sponsor principal está vacío, lo seteamos.
                // También atómico para evitar conflictos.
                if (!userOwner.sponsor) {
                    await User.updateOne(
                        {
                            _id: userOwner._id,
                            $or: [
                                { sponsor: { $exists: false } },
                                { sponsor: null },
                                { sponsor: "" }
                            ]
                        },
                        { $set: { sponsor: normalizedSponsor } }
                    );
                    // Nota: Si el schema define string default, esto podría variar, pero asumimos null/undefined.
                    // Para mayor seguridad podemos chequear si el userOwner traido tenia sponsor vacio y hacer el update directo.
                    // Como ya tenemos 'userOwner' cargado en memoria, podemos confiar en su estado 'sponsor' para la decisión,
                    // pero el update lo hacemos directo a DB.
                }

            }
        }
        // ---------------------------------------------------------

        // Verificamos si es la PRIMERA VEZ que este usuario compra en esta lotería
        // (Buscamos si existe alguna otra box de este owner en esta lotería, excluyendo la que acabamos de crear si ya estuviera)
        // Como acabamos de guardar 'newBox', si buscamos boxes del owner, al menos habrá 1.
        // Si hay exactamente 1, significa que es la primera.
        const userBoxesInLottery = await Box.countDocuments({
            direccionLoteria: normalizedLotteryAddress,
            owner: normalizedOwner
        });

        const boxPrice = lottery ? lottery.boxPrice : 0;

        const updateData = {
            $inc: {
                boxesSold: 1,
                totalRaised: boxPrice
            }
        };

        // Si solo tiene 1 box (la que acabamos de crear), es un NUEVO participante
        if (userBoxesInLottery === 1) {
            updateData.$inc.totalParticipants = 1;
        }

        // --- CALCULAR Y ACTUALIZAR TOP BUYER (Líder de Cajas) ---
        // Buscamos cuál es el máximo de cajas actual para esta lotería
        // Esto garantiza que topBuyerBoxes siempre tenga el récord actual
        const topBuyerAgg = await Box.aggregate([
            { $match: { direccionLoteria: normalizedLotteryAddress } },
            { $group: { _id: "$owner", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]);

        if (topBuyerAgg.length > 0) {
            updateData.$set = { topBuyerBoxes: topBuyerAgg[0].count };
        }

        // Actualizamos el contador de boxes vendidas y participantes (si aplica) en la Lotería
        await Lottery.findOneAndUpdate(
            { address: normalizedLotteryAddress },
            updateData,
            { new: true } // Para que nos devuelva el doc actualizado (opcional)
        );

        res.status(201).json({ msj: "Compra registrada exitosamente en ODDSWIN", box: newBox });

    } catch (error) {
        console.error("Error registrando compra:", error);
        res.status(500).json({ msj: "Error interno registrando la compra" });
    }
};

// Obtener las Boxes de un Usuario (Mis Tickets) con Paginación
// Obtener Boxes de un Usuario (Usando sus wallets vinculadas)
exports.getUserBoxes = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user.id; // Obtenido del token

        // 1. Obtener las wallets del usuario
        const user = await User.findById(userId);

        if (!user || !user.wallets || user.wallets.length === 0) {
            return res.status(200).json({
                boxes: [],
                totalPages: 0,
                currentPage: Number(page),
                totalBoxes: 0
            });
        }

        const userWallets = user.wallets.map(w => w.toLowerCase());

        let searchWallets = [];

        // Lógica de Prioridad:
        // 1. Si el frontend envía una wallet específica (o lista separada por comas), buscamos las cajas de esas wallets.
        if (req.query.walletAddress) {
            const walletsParam = req.query.walletAddress.toLowerCase();
            searchWallets = walletsParam.split(',').map(w => w.trim()).filter(w => w);
        } else {
            // 2. Si no, usamos todas las vinculadas (del usuario del token)
            searchWallets = userWallets;
        }

        const skip = (page - 1) * Number(limit);
        const limitNum = Number(limit);

        // Agregación con Facet para Paginación y Data en una sola consulta
        const result = await Box.aggregate([
            {
                $match: {
                    owner: { $in: searchWallets }, // Usamos la lista filtrada
                    ...(req.query.lotteryAddress ? { direccionLoteria: req.query.lotteryAddress.toLowerCase() } : {})
                }

            },
            {
                $lookup: {
                    from: "lotteries",
                    localField: "direccionLoteria",
                    foreignField: "address",
                    as: "lotteryInfo"
                }
            },
            {
                $unwind: "$lotteryInfo"
            },
            {
                $project: {
                    _id: 1,
                    boxId: 1,
                    ticket1: 1,
                    ticket2: 1,
                    fechaDeCompra: 1,
                    owner: 1,
                    lotteryName: "$lotteryInfo.name",
                    lotterySymbol: "$lotteryInfo.symbol",
                    lotteryAddress: "$direccionLoteria",
                    lotteryImage: "$lotteryInfo.image",
                    hash: "$hashDeLaTransaccion"
                }
            },
            {
                $sort: { fechaDeCompra: -1 }
            },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limitNum }]
                }
            }
        ]);

        const boxes = result[0].data;
        const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;

        res.status(200).json({
            boxes,
            totalPages: Math.ceil(total / limitNum),
            currentPage: Number(page),
            totalBoxes: total
        });

    } catch (error) {
        console.error("Error getUserBoxes:", error);
        res.status(500).json({ msj: "Error interno obteniendo boxes" });
    }
};
// Obtener todas las boxes de una lotería específica (Para Admin Historial)
// Obtener todas las boxes de una lotería específica (Para Admin Historial)
exports.getBoxesByLotteryAddress = async (req, res) => {
    try {
        const { address } = req.params;
        const { page = 1, limit = 50 } = req.query; // Default default to 50

        if (!address) {
            return res.status(400).json({ msj: "Address requerida" });
        }

        const skip = (Number(page) - 1) * Number(limit);

        const boxes = await Box.find({ direccionLoteria: address.toLowerCase() })
            .select("boxId ticket1 ticket2 owner hashDeLaTransaccion")
            .sort({ boxId: -1 }) // Descending: Last first
            .skip(skip)
            .limit(Number(limit));

        const total = await Box.countDocuments({ direccionLoteria: address.toLowerCase() });

        // Mapear para devolver estructura limpia
        const boxesMapped = boxes.map(box => ({
            boxId: box.boxId,
            ticket1: box.ticket1,
            ticket2: box.ticket2,
            owner: box.owner,
            hash: box.hashDeLaTransaccion
        }));

        res.status(200).json({
            boxes: boxesMapped,
            totalPages: Math.ceil(total / Number(limit)),
            currentPage: Number(page),
            totalBoxes: total
        });

    } catch (error) {
        console.error("Error getBoxesByLotteryAddress:", error);
        res.status(500).json({ msj: "Error obteniendo boxes" });
    }
};
