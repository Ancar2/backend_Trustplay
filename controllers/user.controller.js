const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Box = require("../models/oddswin/box.model");
const Lottery = require("../models/oddswin/lottery.model");
const ExclusiveNFT = require("../models/oddswin/exclusiveNFT.model");
const LegalAcceptance = require("../models/legal/legalAcceptance.model");
const sendEmail = require("../utils/sendEmail");
const { buildPasswordResetEmail } = require("../utils/emailTemplates");

const canMutateUser = (req, targetUserId) => (
    req.user
    && (req.user.role === "admin" || String(req.user.id) === String(targetUserId))
);

const toWallet = (value) => (typeof value === "string" ? value.toLowerCase() : "");

const getSponsorshipMap = (user) => {
    const map = new Map();
    if (!user || !Array.isArray(user.sponsorships)) return map;

    user.sponsorships.forEach((entry) => {
        const wallet = toWallet(entry?.wallet);
        if (!wallet) return;
        const sponsor = toWallet(entry?.sponsor) || null;
        map.set(wallet, sponsor);
    });

    return map;
};

const getWalletsSponsoredBy = (user, sponsorWallet) => {
    const targetSponsor = toWallet(sponsorWallet);
    if (!targetSponsor) return [];

    const sponsoredWallets = new Set();
    const sponsorshipMap = getSponsorshipMap(user);

    // Modo estricto: solo usar patrocinador por wallet (sponsorships).
    sponsorshipMap.forEach((specificSponsor, wallet) => {
        if (specificSponsor && specificSponsor === targetSponsor) {
            sponsoredWallets.add(wallet);
        }
    });

    return [...sponsoredWallets];
};

const uniqueWallets = (wallets) => (
    [...new Set((wallets || []).map((wallet) => toWallet(wallet)).filter(Boolean))]
);

const resolveReferralEntriesForSponsor = async (sponsorWallet) => {
    const normalizedSponsor = toWallet(sponsorWallet);
    if (!normalizedSponsor) return [];

    const directUsers = await User.find({ "sponsorships.sponsor": normalizedSponsor }).select("username sponsorships");
    const directMap = new Map();

    directUsers.forEach((user) => {
        (user.sponsorships || []).forEach((entry) => {
            const wallet = toWallet(entry?.wallet);
            const sponsor = toWallet(entry?.sponsor);
            if (!wallet || sponsor !== normalizedSponsor) return;

            if (!directMap.has(wallet)) {
                directMap.set(wallet, {
                    wallet,
                    username: user.username || "Usuario",
                    level: "directo",
                    parentWallet: normalizedSponsor
                });
            }
        });
    });

    const directWallets = [...directMap.keys()];
    if (directWallets.length === 0) {
        return [...directMap.values()];
    }

    const indirectUsers = await User.find({
        "sponsorships.sponsor": { $in: directWallets }
    }).select("username sponsorships");

    const directSet = new Set(directWallets);
    const indirectMap = new Map();

    indirectUsers.forEach((user) => {
        (user.sponsorships || []).forEach((entry) => {
            const wallet = toWallet(entry?.wallet);
            const parentWallet = toWallet(entry?.sponsor);
            if (!wallet || !parentWallet || !directSet.has(parentWallet)) return;
            if (directMap.has(wallet)) return;

            if (!indirectMap.has(wallet)) {
                indirectMap.set(wallet, {
                    wallet,
                    username: user.username || "Usuario",
                    level: "indirecto",
                    parentWallet
                });
            }
        });
    });

    return [...directMap.values(), ...indirectMap.values()];
};

const calculateLifetimeTeamCommissionForWallet = async (sponsorWallet) => {
    const normalizedSponsor = toWallet(sponsorWallet);
    if (!normalizedSponsor) {
        return {
            earnedCommission: 0,
            lostCommission: 0
        };
    }

    const referralEntries = await resolveReferralEntriesForSponsor(normalizedSponsor);
    const referralWallets = uniqueWallets(referralEntries.map((entry) => entry.wallet));
    if (referralWallets.length === 0) {
        return {
            earnedCommission: 0,
            lostCommission: 0
        };
    }

    const referralBoxes = await Box.find({
        owner: { $in: referralWallets }
    }).select("direccionLoteria fechaDeCompra");

    if (referralBoxes.length === 0) {
        return {
            earnedCommission: 0,
            lostCommission: 0
        };
    }

    const lotteryAddresses = uniqueWallets(referralBoxes.map((box) => box.direccionLoteria));

    const [lotteryDocs, activationAgg] = await Promise.all([
        Lottery.find({ address: { $in: lotteryAddresses } }).select("address boxPrice"),
        Box.aggregate([
            { $match: { owner: normalizedSponsor } },
            { $group: { _id: "$direccionLoteria", firstBuyAt: { $min: "$fechaDeCompra" } } }
        ])
    ]);

    const boxPriceMap = new Map();
    lotteryDocs.forEach((lottery) => {
        const address = toWallet(lottery.address);
        if (!address) return;
        boxPriceMap.set(address, Number(lottery.boxPrice || 0));
    });

    const activationMap = new Map();
    activationAgg.forEach((row) => {
        const address = toWallet(row?._id);
        if (!address || !row?.firstBuyAt) return;
        activationMap.set(address, new Date(row.firstBuyAt));
    });

    let earnedCommission = 0;
    let lostCommission = 0;

    referralBoxes.forEach((box) => {
        const lotteryAddress = toWallet(box.direccionLoteria);
        const boxPrice = boxPriceMap.get(lotteryAddress) || 0;
        if (boxPrice <= 0) return;

        const commissionPerBox = boxPrice / 4;
        const activationDate = activationMap.get(lotteryAddress);
        const purchaseDate = box?.fechaDeCompra ? new Date(box.fechaDeCompra) : null;

        if (activationDate && purchaseDate && purchaseDate.getTime() >= activationDate.getTime()) {
            earnedCommission += commissionPerBox;
        } else {
            lostCommission += commissionPerBox;
        }
    });

    return {
        earnedCommission,
        lostCommission
    };
};

const calculateLostCommissionsForLottery = async (sponsorWallet, lotteryAddress) => {
    const normalizedSponsor = toWallet(sponsorWallet);
    const normalizedLottery = toWallet(lotteryAddress);

    if (!normalizedSponsor || !normalizedLottery) {
        return null;
    }

    const lottery = await Lottery.findOne({ address: normalizedLottery }).select("address boxPrice name symbol");
    if (!lottery) {
        return null;
    }

    const sponsorFirstBox = await Box.findOne({
        direccionLoteria: normalizedLottery,
        owner: normalizedSponsor
    }).sort({ fechaDeCompra: 1, createdAt: 1, _id: 1 }).select("fechaDeCompra");

    const activationDate = sponsorFirstBox?.fechaDeCompra ? new Date(sponsorFirstBox.fechaDeCompra) : null;
    const isActive = !!activationDate;
    const commissionPerBox = Number(lottery.boxPrice || 0) / 4;

    const referralEntries = await resolveReferralEntriesForSponsor(normalizedSponsor);
    const referralWallets = uniqueWallets(referralEntries.map((entry) => entry.wallet));

    const baseResponse = {
        lotteryAddress: normalizedLottery,
        lotteryName: lottery.name || "",
        lotterySymbol: lottery.symbol || "",
        sponsorWallet: normalizedSponsor,
        isActive,
        activationDate,
        commissionPerBox,
        totalLostBoxes: 0,
        totalEarnedBoxes: 0,
        totalLostCommission: 0,
        totalEarnedCommission: 0,
        directLostBoxes: 0,
        indirectLostBoxes: 0,
        directLostCommission: 0,
        indirectLostCommission: 0,
        lostByReferral: []
    };

    if (referralWallets.length === 0) {
        return baseResponse;
    }

    const referralBoxDocs = await Box.find({
        direccionLoteria: normalizedLottery,
        owner: { $in: referralWallets }
    }).select("owner fechaDeCompra").sort({ fechaDeCompra: 1, _id: 1 });

    if (referralBoxDocs.length === 0) {
        return baseResponse;
    }

    const referralMap = new Map(referralEntries.map((entry) => [entry.wallet, entry]));
    const statsMap = new Map();

    referralBoxDocs.forEach((box) => {
        const owner = toWallet(box.owner);
        if (!owner) return;

        const relation = referralMap.get(owner);
        if (!relation) return;

        if (!statsMap.has(owner)) {
            statsMap.set(owner, {
                wallet: owner,
                username: relation.username || "Usuario",
                level: relation.level || "directo",
                parentWallet: relation.parentWallet || "",
                firstPurchaseAt: null,
                lastLostAt: null,
                totalBoxes: 0,
                lostBoxes: 0,
                earnedBoxes: 0
            });
        }

        const item = statsMap.get(owner);
        const purchaseDate = box?.fechaDeCompra ? new Date(box.fechaDeCompra) : null;

        item.totalBoxes += 1;

        if (purchaseDate && (!item.firstPurchaseAt || purchaseDate.getTime() < item.firstPurchaseAt.getTime())) {
            item.firstPurchaseAt = purchaseDate;
        }

        if (activationDate && purchaseDate && purchaseDate.getTime() >= activationDate.getTime()) {
            item.earnedBoxes += 1;
        } else {
            item.lostBoxes += 1;
            if (purchaseDate && (!item.lastLostAt || purchaseDate.getTime() > item.lastLostAt.getTime())) {
                item.lastLostAt = purchaseDate;
            }
        }
    });

    const lostByReferral = [];

    statsMap.forEach((item) => {
        const lostCommission = item.lostBoxes * commissionPerBox;
        const earnedCommission = item.earnedBoxes * commissionPerBox;

        baseResponse.totalLostBoxes += item.lostBoxes;
        baseResponse.totalEarnedBoxes += item.earnedBoxes;
        baseResponse.totalLostCommission += lostCommission;
        baseResponse.totalEarnedCommission += earnedCommission;

        if (item.level === "directo") {
            baseResponse.directLostBoxes += item.lostBoxes;
            baseResponse.directLostCommission += lostCommission;
        } else {
            baseResponse.indirectLostBoxes += item.lostBoxes;
            baseResponse.indirectLostCommission += lostCommission;
        }

        if (item.lostBoxes > 0) {
            lostByReferral.push({
                wallet: item.wallet,
                username: item.username,
                level: item.level,
                parentWallet: item.parentWallet,
                firstPurchaseAt: item.firstPurchaseAt,
                lastLostAt: item.lastLostAt,
                totalBoxes: item.totalBoxes,
                lostBoxes: item.lostBoxes,
                lostCommission,
                earnedBoxes: item.earnedBoxes,
                earnedCommission
            });
        }
    });

    lostByReferral.sort((a, b) => {
        const aRecent = a.lastLostAt ? new Date(a.lastLostAt).getTime() : 0;
        const bRecent = b.lastLostAt ? new Date(b.lastLostAt).getTime() : 0;
        if (bRecent !== aRecent) return bRecent - aRecent;
        if (b.lostBoxes !== a.lostBoxes) return b.lostBoxes - a.lostBoxes;
        const aFirst = a.firstPurchaseAt ? new Date(a.firstPurchaseAt).getTime() : 0;
        const bFirst = b.firstPurchaseAt ? new Date(b.firstPurchaseAt).getTime() : 0;
        return aFirst - bFirst;
    });

    return {
        ...baseResponse,
        lostByReferral
    };
};

const roundCurrency = (value) => {
    if (!Number.isFinite(Number(value))) return 0;
    return Number(Number(value).toFixed(8));
};

const getWalletTotalRegaliasFromCollection = async (wallet) => {
    const normalizedWallet = toWallet(wallet);
    if (!normalizedWallet) return 0;

    const result = await ExclusiveNFT.aggregate([
        { $match: { owner: normalizedWallet } },
        {
            $group: {
                _id: null,
                total: { $sum: { $ifNull: ["$totalRegalias", 0] } }
            }
        }
    ]);

    return Number(result?.[0]?.total || 0);
};

const getWalletsTotalRegaliasFromCollection = async (wallets) => {
    const normalizedWallets = uniqueWallets(wallets);
    if (normalizedWallets.length === 0) return 0;

    const result = await ExclusiveNFT.aggregate([
        { $match: { owner: { $in: normalizedWallets } } },
        {
            $group: {
                _id: null,
                total: { $sum: { $ifNull: ["$totalRegalias", 0] } }
            }
        }
    ]);

    return Number(result?.[0]?.total || 0);
};

// Agregar Wallet a Usuario (General)
exports.addWallet = async (req, res) => {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress) {
            return res.status(400).json({ msj: "Falta walletAddress" });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        // Comparación Case-Insensitive
        const walletToAdd = walletAddress.toLowerCase();

        // 1. GLOBAL CHECK: Verificar si la wallet ya está vinculada a OTRO usuario
        const existingOwner = await User.findOne({
            wallets: walletToAdd,
            _id: { $ne: req.user.id } // Excluir al usuario actual de la búsqueda
        });

        if (existingOwner) {
            return res.status(400).json({
                msj: "Esta wallet ya está vinculada a otra cuenta. Debes eliminarla de ese perfil para poder vincularla a este."
            });
        }

        // 2. Normalizar wallets existentes del usuario actual
        const existingWallets = user.wallets.map(w => w.toLowerCase());

        if (!existingWallets.includes(walletToAdd)) {
            user.wallets.push(walletToAdd); // O guardar en formato original si se prefiere
            await user.save();
        } else {
            return res.status(200).json({ msj: "Wallet ya existía", wallets: user.wallets });
        }

        res.status(200).json({ msj: "Wallet agregada", wallets: user.wallets });
    } catch (error) {
        console.error("Error adding wallet:", error);
        res.status(500).json({ msj: "Error interno agregando wallet" });
    }
};

// Obtener Perfil del Usuario Autenticado (Session Check)
exports.getMe = async (req, res) => {
    try {
        // req.user viene del middleware verifyToken
        const user = await User.findById(req.user.id).select("-password"); // Excluir password
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Error getMe:", error);
        res.status(500).json({ msj: "Error obteniendo perfil" });
    }
};

// Actualizar Perfil (Username, Email, Foto) - Lógica Global
exports.updateProfile = async (req, res) => {
    try {
        if (!canMutateUser(req, req.params.id)) {
            return res.status(403).json({ msj: "No tienes permisos para actualizar este perfil" });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        user.username = req.body.username || user.username;
        user.email = req.body.email || user.email;
        user.photo = req.body.photo || user.photo;

        const updatedUser = await user.save();

        const token = jwt.sign({ id: updatedUser._id }, process.env.SECRET_JWT_KEY, {
            expiresIn: process.env.TOKEN_EXPIRE || "24h",
        });

        res.json({
            _id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            role: updatedUser.role,
            photo: updatedUser.photo,
            token: token,
            isLoggedIn: updatedUser.isLoggedIn,
            wallets: updatedUser.wallets,
            sponsor: updatedUser.sponsor
        });

    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ msj: "Error interno actualizando perfil" });
    }
};


// Actualizar Contraseña - Lógica Global
exports.updatePassword = async (req, res) => {
    try {
        if (!canMutateUser(req, req.params.id)) {
            return res.status(403).json({ msj: "No tienes permisos para actualizar esta contraseña" });
        }

        const { currentPassword, newPassword } = req.body;

        // 1. Validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ msj: "Faltan contraseña actual o nueva contraseña" });
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        if (user && (await user.matchPassword(currentPassword))) {
            user.password = newPassword; // El pre-save hook se encargará de hashearlo
            await user.save();
            res.status(200).json({ msj: "Contraseña actualizada correctamente" });
        } else {
            return res.status(401).json({ msj: "Contraseña actual incorrecta" });
        }

    } catch (error) {
        console.error("Error updating password:", error);
        res.status(500).json({ msj: "Error interno actualizando contraseña" });
    }
};


// Desactivar Cuenta (Soft Delete) - Lógica Global
exports.deactivateAccount = async (req, res) => {
    try {
        if (!canMutateUser(req, req.params.id)) {
            return res.status(403).json({ msj: "No tienes permisos para desactivar esta cuenta" });
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        user.isActive = false;
        user.isLoggedIn = false; // Forzar logout
        await user.save();

        res.status(200).json({ msj: "Cuenta desactivada correctamente" });

    } catch (error) {
        console.error("Error deactivating account:", error);
        res.status(500).json({ msj: "Error interno desactivando cuenta" });
    }
};
// --- Password Reset Logic ---

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: "No existe un usuario con ese correo" });
        }

        // Generar token
        const resetToken = crypto.randomBytes(20).toString("hex");

        // Hash token y guardar en DB
        user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
        user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutos

        await user.save();

        // Crear URL de reseteo
        // NOTA: Ajusta la URL del frontend según tu entorno
        const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
        const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
        const emailTemplate = buildPasswordResetEmail({
            resetUrl,
            username: user.username,
            expiresInMinutes: 10
        });

        try {
            await sendEmail({
                email: user.email,
                subject: emailTemplate.subject,
                html: emailTemplate.html,
                message: emailTemplate.text
            });

            res.status(200).json({ success: true, data: "Correo enviado" });
        } catch (error) {
            console.error("Error enviando email:", error);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save();
            return res.status(500).json({ error: "El correo no pudo ser enviado" });
        }

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ error: "Error interno" });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const resetToken = req.params.resetToken;

        // Hash del token recibido para comparar con DB
        const resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");

        const user = await User.findOne({
            resetPasswordToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ error: "Token inválido o expirado" });
        }

        // Setear nueva contraseña
        user.password = req.body.password;

        // Limpiar campos de reset
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;

        await user.save(); // El pre-save hook hasheará la nueva password

        // Opcional: Loguear al usuario directamente o pedirle login
        // Aquí solo confirmamos éxito
        res.status(200).json({ success: true, data: "Contraseña actualizada. Ahora puedes iniciar sesión." });

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ error: "Error interno" });
    }
};

// Obtener Info del Sponsor (Username) dado una Wallet
exports.getSponsorInfo = async (req, res) => {
    try {
        const { wallet } = req.params;
        if (!wallet) return res.status(400).json({ msj: "Falta wallet" });

        const user = await User.findOne({ wallets: wallet.toLowerCase() }).select("username photo");

        if (!user) {
            return res.status(404).json({ msj: "Sponsor no encontrado en plataforma" });
        }

        res.json({
            username: user.username,
            photo: user.photo
        });
    } catch (error) {
        console.error("Error fetching sponsor info:", error);
        res.status(500).json({ msj: "Error interno" });
    }
};

// Obtener el Sponsor de una Wallet Específica (busca en la BD el dueño de la wallet y su sponsor)
exports.getSponsorByWallet = async (req, res) => {
    try {
        const { wallet } = req.params;
        if (!wallet) return res.status(400).json({ msj: "Falta wallet" });

        const targetWallet = wallet.toLowerCase();

        // 1. Buscar el usuario que tiene esta wallet
        const user = await User.findOne({ wallets: targetWallet }).select("sponsor sponsorships username");

        if (!user) {
            return res.status(404).json({ msj: "Wallet no encontrada en plataforma" });
        }

        // 2. Determinar el sponsor correcto de esta wallet
        let sponsorWallet = '';

        // Primero revisar en sponsorships (nueva estructura)
        if (user.sponsorships && user.sponsorships.length > 0) {
            const sponsorship = user.sponsorships.find(s => s.wallet && s.wallet.toLowerCase() === targetWallet);
            if (sponsorship?.sponsor) {
                sponsorWallet = sponsorship.sponsor.toLowerCase();
            }
        }

        // Fallback a sponsor global REMOVIDO por solicitud
        // if (!sponsorWallet && user.sponsor) {
        //     sponsorWallet = user.sponsor.toLowerCase();
        // }

        // 3. Si no hay sponsor válido
        if (!sponsorWallet || sponsorWallet === '0x0000000000000000000000000000000000000000') {
            return res.json({
                sponsorWallet: '',
                sponsorName: 'Sin Patrocinador',
                sponsorPhoto: null
            });
        }

        // 4. Buscar info del sponsor
        const sponsorUser = await User.findOne({ wallets: sponsorWallet }).select("username photo");

        if (!sponsorUser) {
            return res.json({
                sponsorWallet: sponsorWallet,
                sponsorName: 'Desconocido',
                sponsorPhoto: null,
                isActive: false
            });
        }

        // 5. Check if ACTIVE in the specific Lottery (if provided)
        let isActive = false;
        const { lotteryAddress } = req.query; // Get from query

        if (lotteryAddress) {
            const boxCount = await Box.countDocuments({
                direccionLoteria: lotteryAddress.toLowerCase(),
                owner: sponsorWallet
            });
            isActive = boxCount > 0;
        }

        res.json({
            sponsorWallet: sponsorWallet,
            sponsorName: sponsorUser.username || 'Desconocido',
            sponsorPhoto: sponsorUser.photo,
            isActive: isActive
        });

    } catch (error) {
        console.error("Error fetching sponsor by wallet:", error);
        res.status(500).json({ msj: "Error interno" });
    }
};

// Obtener Resumen de Referidos (Directos e Indirectos)
// Obtener Resumen de Referidos (Directos e Indirectos)
exports.getReferralSummary = async (req, res) => {
    try {
        const { wallet } = req.params;
        const { lotteryAddress } = req.query;

        if (!wallet) return res.status(400).json({ msj: "Falta wallet" });

        const myUser = await User.findOne({ wallets: wallet.toLowerCase() });
        if (!myUser) {
            return res.status(404).json({ msj: "Usuario no encontrado para esta wallet" });
        }

        // STRICT FILTERING: Only count referrals for THIS specific wallet
        const targetWallet = wallet.toLowerCase();

        // 1. Direct Referrals Search: Find users who have potential link strictly to current wallet
        const directQuery = {
            $or: [
                { sponsor: targetWallet },
                { "sponsorships.sponsor": targetWallet }
            ]
        };

        const directUsers = await User.find(directQuery).select("wallets sponsor sponsorships");

        // 2. Identify specifically WHICH wallets are sponsored by ME (the connected wallet)
        const mySponsoredWallets = [];

        directUsers.forEach(user => {
            // Normalize user data
            const userGlobalSponsor = user.sponsor ? user.sponsor.toLowerCase() : null;
            const hasSponsorships = user.sponsorships && user.sponsorships.length > 0;

            if (hasSponsorships) {
                // STRICT MODE: Only check the sponsorships array
                user.sponsorships.forEach(s => {
                    if (s.sponsor && s.sponsor.toLowerCase() === targetWallet) {
                        mySponsoredWallets.push(s.wallet.toLowerCase());
                    }
                });
            } else {
                // LEGACY MODE: Use global sponsor for all wallets
                if (userGlobalSponsor === targetWallet) {
                    user.wallets.forEach(w => mySponsoredWallets.push(w.toLowerCase()));
                }
            }
        });

        const directCount = mySponsoredWallets.length;

        // 3. Calculate "Active" Direct Referrals (Users & Volume)
        let activeDirectVolume = 0;
        let activeDirectUsers = 0;

        if (lotteryAddress && directCount > 0) {
            // Volume (Total Boxes)
            activeDirectVolume = await Box.countDocuments({
                direccionLoteria: lotteryAddress.toLowerCase(),
                owner: { $in: mySponsoredWallets }
            });
            // Unique Users (Buyers)
            const uniqueBuyers = await Box.distinct("owner", {
                direccionLoteria: lotteryAddress.toLowerCase(),
                owner: { $in: mySponsoredWallets }
            });
            activeDirectUsers = uniqueBuyers.length;
        }

        // 4. Indirect Referrals (Wallets)
        let indirectCount = 0;
        let activeIndirectVolume = 0;
        let activeIndirectUsers = 0;

        if (directCount > 0) {
            const indirectQuery = {
                $or: [
                    { sponsor: { $in: mySponsoredWallets } },
                    { "sponsorships.sponsor": { $in: mySponsoredWallets } }
                ]
            };

            // Find users who are sponsored by my Direct Referrals
            const indirectUsers = await User.find(indirectQuery).select("wallets sponsor sponsorships");
            const indirectWalletsList = []; // Store confirmed indirect wallets

            // Count distinct wallets that are specifically sponsored by one of "mySponsoredWallets"
            indirectUsers.forEach(u => {
                const uGlobalSponsor = u.sponsor ? u.sponsor.toLowerCase() : null;
                const hasSponsorships = u.sponsorships && u.sponsorships.length > 0;

                if (hasSponsorships) {
                    // STRICT MODE
                    u.sponsorships.forEach(s => {
                        const actualSponsor = s.sponsor ? s.sponsor.toLowerCase() : null;
                        if (actualSponsor && mySponsoredWallets.includes(actualSponsor)) {
                            indirectCount++;
                            indirectWalletsList.push(s.wallet.toLowerCase());
                        }
                    });
                } else {
                    // LEGACY MODE
                    u.wallets.forEach(w => {
                        const wLower = w.toLowerCase();
                        // Global sponsor is the effective sponsor here
                        if (uGlobalSponsor && mySponsoredWallets.includes(uGlobalSponsor)) {
                            indirectCount++;
                            indirectWalletsList.push(wLower);
                        }
                    });
                }
            });

            // 4.1 Calculate "Active" Indirect Referrals (Users & Volume)
            if (lotteryAddress && indirectCount > 0) {
                // Volume
                activeIndirectVolume = await Box.countDocuments({
                    direccionLoteria: lotteryAddress.toLowerCase(),
                    owner: { $in: indirectWalletsList }
                });
                // Unique Users
                const uniqueIndirectBuyers = await Box.distinct("owner", {
                    direccionLoteria: lotteryAddress.toLowerCase(),
                    owner: { $in: indirectWalletsList }
                });
                activeIndirectUsers = uniqueIndirectBuyers.length;
            }
        }

        res.json({
            direct: directCount, // Total registered referrals
            activeDirectUsers: activeDirectUsers, // Unique buyers
            activeDirectVolume: activeDirectVolume, // Total boxes bought

            indirect: indirectCount,
            activeIndirectUsers: activeIndirectUsers,
            activeIndirectVolume: activeIndirectVolume
        });

    } catch (error) {
        console.error("Error calculating referrals:", error);
        res.status(500).json({ msj: "Error interno calculando referidos" });
    }
};

// Obtener Lista de Recomendados Directos (Wallets)
exports.getDirectReferrals = async (req, res) => {
    try {
        const { wallet } = req.params;
        if (!wallet) return res.status(400).json({ msj: "Falta wallet" });

        const targetWallet = wallet.toLowerCase();

        // Query: Find users where (sponsor == target) OR (sponsorships.sponsor == target)
        const directQuery = {
            $or: [
                { sponsor: targetWallet },
                { "sponsorships.sponsor": targetWallet }
            ]
        };

        const directUsers = await User.find(directQuery).select("wallets sponsor sponsorships username photo");
        const referralList = [];

        directUsers.forEach(user => {
            const sponsoredWallets = getWalletsSponsoredBy(user, targetWallet);

            sponsoredWallets.forEach((wallet) => {
                referralList.push({
                    wallet,
                    username: user.username || "Usuario",
                    photo: user.photo,
                    boxCount: 0
                });
            });
        });

        // Optional: Aggregate Box Counts for these wallets in Active Lottery?
        // For now, returning basic list.

        const status = req.query.status || 'all'; // 'all', 'active', 'inactive'
        const lotteryAddress = req.query.lotteryAddress;
        const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

        // --- OPTIMIZATION: Fetch Active Owners ONCE ---
        const activeOwnersSet = new Set();
        const boxCountsMap = new Map();

        if (lotteryAddress) {
            // 1. Get all owners who bought in this lottery
            const owners = await Box.find({ direccionLoteria: lotteryAddress.toLowerCase() }).select('owner');

            // 2. Build Set and Map for O(1) checks
            owners.forEach(box => {
                const w = box.owner.toLowerCase();
                activeOwnersSet.add(w);
                boxCountsMap.set(w, (boxCountsMap.get(w) || 0) + 1);
            });
        }

        // --- FILTER & ENRICH LIST ---
        let filteredList = [];

        referralList.forEach(ref => {
            const walletLower = ref.wallet.toLowerCase();

            if (search) {
                const usernameLower = String(ref.username || "").toLowerCase();
                const matchesSearch = usernameLower.includes(search) || walletLower.includes(search);
                if (!matchesSearch) {
                    return;
                }
            }

            // Determine Active Status & Box Count
            const count = boxCountsMap.get(walletLower) || 0;
            const isActive = activeOwnersSet.has(walletLower);

            // Assign computed props
            ref.boxCount = count;
            ref.isActive = isActive;

            // Apply Filter
            if (status === 'active') {
                if (isActive) filteredList.push(ref);
            } else if (status === 'inactive') {
                if (!isActive) filteredList.push(ref);
            } else {
                // 'all'
                filteredList.push(ref);
            }
        });

        // --- PAGINATION ---
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const totalItems = filteredList.length;
        const totalPages = Math.ceil(totalItems / limit);
        const paginatedReferrals = filteredList.slice(startIndex, endIndex);

        // --- ENRICH WITH DIRECT REFERRALS STATS (Active / Total) ---
        // Optimización: Calcular Active/Total para cada referido paginado
        await Promise.all(paginatedReferrals.map(async (ref) => {
            const refWallet = ref.wallet.toLowerCase();

            // 1. Find potential downlines
            const downlines = await User.find({
                $or: [
                    { sponsor: refWallet },
                    { "sponsorships.sponsor": refWallet }
                ]
            }).select("wallets sponsor sponsorships");

            // 2. Filter strictly
            let myDownlineWallets = [];
            downlines.forEach(u => {
                myDownlineWallets.push(...getWalletsSponsoredBy(u, refWallet));
            });

            // 3. Calc Stats
            const uniqueDownlines = [...new Set(myDownlineWallets)];
            const totalDirects = uniqueDownlines.length;
            let activeInLottery = 0;

            if (lotteryAddress) {
                uniqueDownlines.forEach(dw => {
                    if (activeOwnersSet.has(dw)) activeInLottery++;
                });
            }

            ref.directCount = totalDirects;
            ref.activeDirectCount = activeInLottery;
        }));

        res.json({
            referrals: paginatedReferrals,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                itemsPerPage: limit
            }
        });

    } catch (error) {
        console.error("Error fetching direct referrals list:", error);
        res.status(500).json({ msj: "Error obteniendo lista de directos" });
    }
};

// Obtener Lista de Recomendados Indirectos (Wallets)
exports.getIndirectReferrals = async (req, res) => {
    try {
        const { wallet } = req.params;
        if (!wallet) return res.status(400).json({ msj: "Falta wallet" });

        const targetWallet = wallet.toLowerCase();

        // 1. Find DIRECT Referrals first (Level 1)
        const directQuery = {
            $or: [
                { sponsor: targetWallet },
                { "sponsorships.sponsor": targetWallet }
            ]
        };
        const directUsers = await User.find(directQuery).select("wallets sponsor sponsorships");
        const myDirectWallets = [];

        directUsers.forEach(user => {
            const userGlobalSponsor = user.sponsor ? user.sponsor.toLowerCase() : null;
            const hasSponsorships = user.sponsorships && user.sponsorships.length > 0;

            if (hasSponsorships) {
                user.sponsorships.forEach(s => {
                    if (s.sponsor && s.sponsor.toLowerCase() === targetWallet) {
                        myDirectWallets.push(s.wallet.toLowerCase());
                    }
                });
            } else {
                if (userGlobalSponsor === targetWallet) {
                    user.wallets.forEach(w => myDirectWallets.push(w.toLowerCase()));
                }
            }
        });

        if (myDirectWallets.length === 0) {
            return res.json({
                referrals: [],
                pagination: { totalItems: 0, totalPages: 0, currentPage: 1, itemsPerPage: 50 }
            });
        }

        // 2. Find INDIRECT Referrals (Level 2) - Users sponsored by myDirectWallets
        const indirectQuery = {
            $or: [
                { sponsor: { $in: myDirectWallets } },
                { "sponsorships.sponsor": { $in: myDirectWallets } }
            ]
        };

        const indirectUsers = await User.find(indirectQuery).select("wallets sponsor sponsorships username photo");
        const referralList = [];

        indirectUsers.forEach(user => {
            const userGlobalSponsor = user.sponsor ? user.sponsor.toLowerCase() : null;
            const hasSponsorships = user.sponsorships && user.sponsorships.length > 0;

            if (hasSponsorships) {
                user.sponsorships.forEach(s => {
                    const actualSponsor = s.sponsor ? s.sponsor.toLowerCase() : null;
                    if (actualSponsor && myDirectWallets.includes(actualSponsor)) {
                        referralList.push({
                            wallet: s.wallet.toLowerCase(),
                            username: user.username || 'Usuario',
                            photo: user.photo,
                            boxCount: 0,
                            sponsorWallet: actualSponsor // Helpful to know who referred them
                        });
                    }
                });
            } else {
                user.wallets.forEach(w => {
                    const wLower = w.toLowerCase();
                    // Global sponsor check
                    if (userGlobalSponsor && myDirectWallets.includes(userGlobalSponsor)) {
                        referralList.push({
                            wallet: wLower,
                            username: user.username || 'Usuario',
                            photo: user.photo,
                            boxCount: 0,
                            sponsorWallet: userGlobalSponsor
                        });
                    }
                });
            }
        });

        // 3. Status Filtering & Enrichment Logic (Same as Direct)
        const status = req.query.status || 'all'; // 'all', 'active', 'inactive'
        const lotteryAddress = req.query.lotteryAddress;
        const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

        // --- OPTIMIZATION: Fetch Active Owners ONCE ---
        const activeOwnersSet = new Set();
        const boxCountsMap = new Map();

        if (lotteryAddress) {
            const owners = await Box.find({ direccionLoteria: lotteryAddress.toLowerCase() }).select('owner');
            owners.forEach(box => {
                const w = box.owner.toLowerCase();
                activeOwnersSet.add(w);
                boxCountsMap.set(w, (boxCountsMap.get(w) || 0) + 1);
            });
        }

        // --- FILTER & ENRICH LIST ---
        let filteredList = [];

        referralList.forEach(ref => {
            const walletLower = ref.wallet.toLowerCase();

            if (search) {
                const usernameLower = String(ref.username || "").toLowerCase();
                const matchesSearch = usernameLower.includes(search) || walletLower.includes(search);
                if (!matchesSearch) {
                    return;
                }
            }

            const count = boxCountsMap.get(walletLower) || 0;
            const isActive = activeOwnersSet.has(walletLower);

            ref.boxCount = count;
            ref.isActive = isActive;

            if (status === 'active') {
                if (isActive) filteredList.push(ref);
            } else if (status === 'inactive') {
                if (!isActive) filteredList.push(ref);
            } else {
                filteredList.push(ref);
            }
        });

        // --- PAGINATION ---
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const totalItems = filteredList.length;
        const totalPages = Math.ceil(totalItems / limit);
        const paginatedReferrals = filteredList.slice(startIndex, endIndex);

        // --- ENRICH WITH DIRECT REFERRALS STATS (Active / Total) for Indirects too ---
        await Promise.all(paginatedReferrals.map(async (ref) => {
            const refWallet = ref.wallet.toLowerCase();

            // 1. Find potential downlines of this indirect referral
            const downlines = await User.find({
                $or: [
                    { sponsor: refWallet },
                    { "sponsorships.sponsor": refWallet }
                ]
            }).select("wallets sponsor sponsorships");

            // 2. Filter strictly
            let myReferralsDownlines = [];
            downlines.forEach(u => {
                const uGlobal = u.sponsor ? u.sponsor.toLowerCase() : null;
                const hasSponsorships = u.sponsorships && u.sponsorships.length > 0;

                if (hasSponsorships) {
                    u.sponsorships.forEach(s => {
                        if (s.sponsor && s.sponsor.toLowerCase() === refWallet) {
                            myReferralsDownlines.push(s.wallet.toLowerCase());
                        }
                    });
                } else {
                    if (uGlobal === refWallet) {
                        u.wallets.forEach(w => myReferralsDownlines.push(w.toLowerCase()));
                    }
                }
            });

            // 3. Calc Stats
            const totalDirects = myReferralsDownlines.length;
            let activeInLottery = 0;

            if (lotteryAddress) {
                myReferralsDownlines.forEach(dw => {
                    if (activeOwnersSet.has(dw)) activeInLottery++;
                });
            }

            ref.directCount = totalDirects;
            ref.activeDirectCount = activeInLottery;
        }));

        res.json({
            referrals: paginatedReferrals,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                itemsPerPage: limit
            }
        });

    } catch (error) {
        console.error("Error fetching indirect referrals list:", error);
        res.status(500).json({ msj: "Error obteniendo lista de indirectos" });
    }
};

// Obtener Ganancias Totales (Histórico)
exports.getTotalEarnings = async (req, res) => {
    try {
        const userId = req.user.id;
        const targetWallet = req.query.wallet ? toWallet(req.query.wallet) : null; // Wallet específica (opcional)

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ msj: "Usuario no encontrado" });

        const userWallets = uniqueWallets(user.wallets || []);

        if (targetWallet && !userWallets.includes(targetWallet)) {
            return res.status(403).json({ msj: "La wallet consultada no pertenece al usuario autenticado" });
        }

        // --- 1) TEAM REWARDS REALMENTE GANADAS ---
        let totalTeamRewardsGlobal = 0;
        let totalTeamRewardsLostGlobal = 0;

        if (userWallets.length > 0) {
            const globalSnapshots = await Promise.all(
                userWallets.map((wallet) => calculateLifetimeTeamCommissionForWallet(wallet))
            );

            globalSnapshots.forEach((snapshot) => {
                totalTeamRewardsGlobal += Number(snapshot.earnedCommission || 0);
                totalTeamRewardsLostGlobal += Number(snapshot.lostCommission || 0);
            });
        }

        let totalTeamRewardsSpecific = 0;
        let totalTeamRewardsLostSpecific = 0;
        if (targetWallet) {
            const specificSnapshot = await calculateLifetimeTeamCommissionForWallet(targetWallet);
            totalTeamRewardsSpecific = Number(specificSnapshot.earnedCommission || 0);
            totalTeamRewardsLostSpecific = Number(specificSnapshot.lostCommission || 0);
        }

        // --- 2) PREMIOS HISTORICOS ---
        const prizesQueryGlobal = {
            $or: [
                { winnerAddress: { $in: userWallets } },
                { winnerSponsor: { $in: userWallets } },
                { winnerTopBuyer: { $in: userWallets } },
                { winnerMostReferrals: { $in: userWallets } }
            ]
        };
        const winningLotteries = await Lottery.find(prizesQueryGlobal);

        let totalPrizesGlobal = 0;
        let totalPrizesSpecific = 0;

        winningLotteries.forEach((lot) => {
            const addressesToCheckGlobal = userWallets;
            let earnedInLotteryGlobal = 0;

            if (lot.winnerAddress && addressesToCheckGlobal.includes(lot.winnerAddress.toLowerCase())) earnedInLotteryGlobal += (lot.winnerPrize || 0);
            if (lot.winnerSponsor && addressesToCheckGlobal.includes(lot.winnerSponsor.toLowerCase())) earnedInLotteryGlobal += (lot.sponsorPrize || 0);
            if (lot.winnerTopBuyer && addressesToCheckGlobal.includes(lot.winnerTopBuyer.toLowerCase())) earnedInLotteryGlobal += (lot.topBuyerPrize || 0);
            if (lot.winnerMostReferrals && addressesToCheckGlobal.includes(lot.winnerMostReferrals.toLowerCase())) earnedInLotteryGlobal += (lot.mostReferralsPrize || 0);
            totalPrizesGlobal += earnedInLotteryGlobal;

            if (targetWallet) {
                let earnedInLotterySpecific = 0;
                if (lot.winnerAddress && lot.winnerAddress.toLowerCase() === targetWallet) earnedInLotterySpecific += (lot.winnerPrize || 0);
                if (lot.winnerSponsor && lot.winnerSponsor.toLowerCase() === targetWallet) earnedInLotterySpecific += (lot.sponsorPrize || 0);
                if (lot.winnerTopBuyer && lot.winnerTopBuyer.toLowerCase() === targetWallet) earnedInLotterySpecific += (lot.topBuyerPrize || 0);
                if (lot.winnerMostReferrals && lot.winnerMostReferrals.toLowerCase() === targetWallet) earnedInLotterySpecific += (lot.mostReferralsPrize || 0);
                totalPrizesSpecific += earnedInLotterySpecific;
            }
        });

        // --- 3) REGALIAS NFT EXCLUSIVO ---
        // Se usa el acumulado real registrado en BD (totalRegalias), no una proyeccion.
        let totalNftRoyaltiesGlobal = 0;
        let totalNftRoyaltiesSpecific = 0;

        try {
            totalNftRoyaltiesGlobal = await getWalletsTotalRegaliasFromCollection(userWallets);
            if (targetWallet) {
                totalNftRoyaltiesSpecific = await getWalletTotalRegaliasFromCollection(targetWallet);
            }
        } catch (err) {
            console.error("Error calculating NFT Royalties:", err);
            // Non-blocking, just 0
        }

        res.status(200).json({
            teamRewards: totalTeamRewardsGlobal,
            prizesWon: totalPrizesGlobal + totalNftRoyaltiesGlobal, // Inclusive of NFT royalties as per request
            totalEarnings: totalTeamRewardsGlobal + totalPrizesGlobal + totalNftRoyaltiesGlobal,
            walletEarnings: targetWallet ? (totalTeamRewardsSpecific + totalPrizesSpecific + totalNftRoyaltiesSpecific) : 0,
            lostTeamRewards: totalTeamRewardsLostGlobal,
            walletLostTeamRewards: targetWallet ? totalTeamRewardsLostSpecific : 0
        });

    } catch (error) {
        console.error("Error calculating total earnings:", error);
        res.status(500).json({ msj: "Error calculando ganancias" });
    }
};

// Obtener detalle de ganancias por loteria para una wallet especifica
exports.getEarningsBreakdownByLottery = async (req, res) => {
    try {
        const targetWallet = toWallet(req.params.wallet);
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const requestedLimit = Number.parseInt(req.query.limit, 10) || 10;
        const limit = Math.min(10, Math.max(1, requestedLimit));

        if (!targetWallet) {
            return res.status(400).json({ msj: "Falta wallet" });
        }

        const user = await User.findById(req.user.id).select("wallets");
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        const userWallets = uniqueWallets(user.wallets || []);
        if (!userWallets.includes(targetWallet)) {
            return res.status(403).json({ msj: "La wallet consultada no pertenece al usuario autenticado" });
        }

        const rowsMap = new Map();
        const ensureRow = (lotteryAddress, info = {}) => {
            const normalizedLotteryAddress = toWallet(lotteryAddress);
            if (!normalizedLotteryAddress) return null;

            if (!rowsMap.has(normalizedLotteryAddress)) {
                rowsMap.set(normalizedLotteryAddress, {
                    lotteryAddress: normalizedLotteryAddress,
                    lotteryName: info.name || "Loteria",
                    lotterySymbol: info.symbol || "",
                    year: Number.isFinite(Number(info.year)) ? Number(info.year) : null,
                    index: Number.isFinite(Number(info.index)) ? Number(info.index) : null,
                    directTeamGain: 0,
                    indirectTeamGain: 0,
                    directTeamLost: 0,
                    indirectTeamLost: 0,
                    lostTeamGain: 0,
                    lastLostAt: null,
                    teamGain: 0,
                    nftExclusiveGain: 0,
                    prizeGain: 0,
                    prizeRoles: [],
                    totalGain: 0
                });
            }

            return rowsMap.get(normalizedLotteryAddress);
        };

        // ---------------------------------------------------------------------
        // 1) Ganancia por equipo (directos/indirectos) con regla de activacion
        // ---------------------------------------------------------------------
        const referralEntries = await resolveReferralEntriesForSponsor(targetWallet);
        const referralWallets = uniqueWallets(referralEntries.map((entry) => entry.wallet));
        const referralByWallet = new Map(referralEntries.map((entry) => [entry.wallet, entry]));

        const activationAgg = await Box.aggregate([
            { $match: { owner: targetWallet } },
            { $group: { _id: "$direccionLoteria", firstBuyAt: { $min: "$fechaDeCompra" } } }
        ]);

        const activationMap = new Map();
        activationAgg.forEach((row) => {
            const lotteryAddress = toWallet(row?._id);
            if (!lotteryAddress || !row?.firstBuyAt) return;
            activationMap.set(lotteryAddress, new Date(row.firstBuyAt));
        });

        const referralBoxes = referralWallets.length > 0
            ? await Box.find({ owner: { $in: referralWallets } }).select("owner direccionLoteria fechaDeCompra")
            : [];

        const teamLotteryAddresses = uniqueWallets(referralBoxes.map((box) => box.direccionLoteria));
        const teamLotteries = teamLotteryAddresses.length > 0
            ? await Lottery.find({ address: { $in: teamLotteryAddresses } }).select("address name symbol year index boxPrice")
            : [];
        const teamLotteryMap = new Map(teamLotteries.map((lottery) => [toWallet(lottery.address), lottery]));

        referralBoxes.forEach((box) => {
            const lotteryAddress = toWallet(box.direccionLoteria);
            const ownerWallet = toWallet(box.owner);
            if (!lotteryAddress || !ownerWallet) return;

            const lotteryInfo = teamLotteryMap.get(lotteryAddress);
            const boxPrice = Number(lotteryInfo?.boxPrice || 0);
            if (boxPrice <= 0) return;

            const row = ensureRow(lotteryAddress, lotteryInfo || {});
            if (!row) return;

            const commission = boxPrice / 4;
            const relation = referralByWallet.get(ownerWallet);
            const level = String(relation?.level || "directo").toLowerCase();

            const activationDate = activationMap.get(lotteryAddress);
            const purchaseDate = box?.fechaDeCompra ? new Date(box.fechaDeCompra) : null;

            // Si no estaba activo para esa loteria al momento de la compra, esa comision ya se perdio.
            if (!activationDate || !purchaseDate || purchaseDate.getTime() < activationDate.getTime()) {
                if (level === "indirecto") {
                    row.indirectTeamLost += commission;
                } else {
                    row.directTeamLost += commission;
                }
                if (purchaseDate && (!row.lastLostAt || purchaseDate.getTime() > row.lastLostAt.getTime())) {
                    row.lastLostAt = purchaseDate;
                }
                return;
            }

            if (level === "indirecto") {
                row.indirectTeamGain += commission;
            } else {
                row.directTeamGain += commission;
            }
        });

        // ---------------------------------------------------------------------
        // 2) Ganancia por premios en cada loteria (rol)
        // ---------------------------------------------------------------------
        const wonLotteries = await Lottery.find({
            $or: [
                { winnerAddress: targetWallet },
                { winnerSponsor: targetWallet },
                { winnerTopBuyer: targetWallet },
                { winnerMostReferrals: targetWallet }
            ]
        }).select(
            "address name symbol year index winnerAddress winnerSponsor winnerTopBuyer winnerMostReferrals winnerPrize sponsorPrize topBuyerPrize mostReferralsPrize"
        );

        wonLotteries.forEach((lottery) => {
            const lotteryAddress = toWallet(lottery.address);
            const row = ensureRow(lotteryAddress, lottery);
            if (!row) return;

            const roles = [];
            let prizeGain = 0;

            if (toWallet(lottery.winnerAddress) === targetWallet) {
                prizeGain += Number(lottery.winnerPrize || 0);
                roles.push("Ganador mayor");
            }
            if (toWallet(lottery.winnerSponsor) === targetWallet) {
                prizeGain += Number(lottery.sponsorPrize || 0);
                roles.push("Sponsor ganador");
            }
            if (toWallet(lottery.winnerTopBuyer) === targetWallet) {
                prizeGain += Number(lottery.topBuyerPrize || 0);
                roles.push("Top comprador");
            }
            if (toWallet(lottery.winnerMostReferrals) === targetWallet) {
                prizeGain += Number(lottery.mostReferralsPrize || 0);
                roles.push("Top embajador");
            }

            row.prizeGain += prizeGain;
            row.prizeRoles = [...new Set([...(row.prizeRoles || []), ...roles])];
        });

        // ---------------------------------------------------------------------
        // 3) Ganancia NFT exclusivo (usa totalRegalias real y la reparte por evento)
        // ---------------------------------------------------------------------
        try {
            const totalRegaliasWallet = await getWalletTotalRegaliasFromCollection(targetWallet);

            if (totalRegaliasWallet > 0) {
                const completedLotteries = await Lottery.find({
                    completed: true,
                    percentageExclusiveNft: { $gt: 0 }
                }).select("address name symbol year index totalBoxes boxPrice percentageExclusiveNft");

                const weights = [];
                let totalWeight = 0;

                completedLotteries.forEach((lottery) => {
                    const lotteryAddress = toWallet(lottery.address);
                    if (!lotteryAddress) return;

                    // Peso relativo del evento para repartir totalRegalias acumuladas.
                    const totalPool = Number(lottery.totalBoxes || 0) * Number(lottery.boxPrice || 0);
                    const halfPool = totalPool / 2;
                    const nftPool = halfPool * (Number(lottery.percentageExclusiveNft || 0) / 10000);
                    const weight = Number.isFinite(nftPool) && nftPool > 0 ? nftPool : 0;

                    if (weight > 0) {
                        weights.push({ lotteryAddress, weight, lottery });
                        totalWeight += weight;
                    }
                });

                if (weights.length > 0 && totalWeight > 0) {
                    weights.forEach(({ lotteryAddress, weight, lottery }) => {
                        const row = ensureRow(lotteryAddress, lottery);
                        if (!row) return;
                        row.nftExclusiveGain += (totalRegaliasWallet * weight) / totalWeight;
                    });
                } else {
                    // Fallback: si no hay forma de mapear por evento, se muestra como acumulado NFT.
                    const syntheticRow = ensureRow(
                        `nft-acumulado-${targetWallet}`,
                        {
                            name: "Regalías NFT acumuladas",
                            symbol: "NFT",
                            year: null,
                            index: null
                        }
                    );
                    if (syntheticRow) {
                        syntheticRow.nftExclusiveGain += totalRegaliasWallet;
                    }
                }
            }
        } catch (error) {
            console.error("Error calculando detalle de NFT exclusivo por loteria:", error);
        }

        const rows = [...rowsMap.values()]
            .map((row) => {
                const directTeamGain = roundCurrency(row.directTeamGain);
                const indirectTeamGain = roundCurrency(row.indirectTeamGain);
                const directTeamLost = roundCurrency(row.directTeamLost);
                const indirectTeamLost = roundCurrency(row.indirectTeamLost);
                const lostTeamGain = roundCurrency(directTeamLost + indirectTeamLost);
                const teamGain = roundCurrency(directTeamGain + indirectTeamGain);
                const nftExclusiveGain = roundCurrency(row.nftExclusiveGain);
                const prizeGain = roundCurrency(row.prizeGain);
                const totalGain = roundCurrency(teamGain + nftExclusiveGain + prizeGain);

                return {
                    ...row,
                    directTeamGain,
                    indirectTeamGain,
                    directTeamLost,
                    indirectTeamLost,
                    lostTeamGain,
                    lastLostAt: row.lastLostAt || null,
                    teamGain,
                    nftExclusiveGain,
                    prizeGain,
                    totalGain
                };
            })
            .filter((row) => row.totalGain > 0 || row.lostTeamGain > 0)
            .sort((a, b) => {
                const aRecent = a.lastLostAt ? new Date(a.lastLostAt).getTime() : 0;
                const bRecent = b.lastLostAt ? new Date(b.lastLostAt).getTime() : 0;
                if (bRecent !== aRecent) return bRecent - aRecent;

                const yearA = Number.isFinite(a.year) ? a.year : -1;
                const yearB = Number.isFinite(b.year) ? b.year : -1;
                if (yearA !== yearB) return yearB - yearA;

                const indexA = Number.isFinite(a.index) ? a.index : -1;
                const indexB = Number.isFinite(b.index) ? b.index : -1;
                if (indexA !== indexB) return indexB - indexA;

                return b.totalGain - a.totalGain;
            });

        const totalItems = rows.length;
        const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 0;
        const start = (page - 1) * limit;
        const end = start + limit;
        const pagedRows = rows.slice(start, end);

        const totals = rows.reduce(
            (acc, row) => {
                acc.directTeamGain += row.directTeamGain;
                acc.indirectTeamGain += row.indirectTeamGain;
                acc.directTeamLost += row.directTeamLost;
                acc.indirectTeamLost += row.indirectTeamLost;
                acc.lostTeamGain += row.lostTeamGain;
                acc.teamGain += row.teamGain;
                acc.nftExclusiveGain += row.nftExclusiveGain;
                acc.prizeGain += row.prizeGain;
                acc.totalGain += row.totalGain;
                return acc;
            },
            {
                directTeamGain: 0,
                indirectTeamGain: 0,
                directTeamLost: 0,
                indirectTeamLost: 0,
                lostTeamGain: 0,
                teamGain: 0,
                nftExclusiveGain: 0,
                prizeGain: 0,
                totalGain: 0
            }
        );

        return res.status(200).json({
            wallet: targetWallet,
            rows: pagedRows,
            pagination: {
                page,
                limit,
                totalItems,
                totalPages
            },
            totals: {
                directTeamGain: roundCurrency(totals.directTeamGain),
                indirectTeamGain: roundCurrency(totals.indirectTeamGain),
                directTeamLost: roundCurrency(totals.directTeamLost),
                indirectTeamLost: roundCurrency(totals.indirectTeamLost),
                lostTeamGain: roundCurrency(totals.lostTeamGain),
                teamGain: roundCurrency(totals.teamGain),
                nftExclusiveGain: roundCurrency(totals.nftExclusiveGain),
                prizeGain: roundCurrency(totals.prizeGain),
                totalGain: roundCurrency(totals.totalGain)
            }
        });
    } catch (error) {
        console.error("Error obteniendo detalle de ganancias por loteria:", error);
        return res.status(500).json({ msj: "Error obteniendo detalle de ganancias" });
    }
};

// Obtener comisiones perdidas por no estar activo en una loteria especifica
exports.getLostEarningsByLottery = async (req, res) => {
    try {
        const wallet = toWallet(req.params.wallet);
        const lotteryAddress = toWallet(req.query.lotteryAddress);
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const requestedLimit = Number.parseInt(req.query.limit, 10) || 10;
        const limit = Math.min(10, Math.max(1, requestedLimit));

        if (!wallet) {
            return res.status(400).json({ msj: "Falta wallet" });
        }

        if (!lotteryAddress) {
            return res.status(400).json({ msj: "Falta lotteryAddress" });
        }

        const snapshot = await calculateLostCommissionsForLottery(wallet, lotteryAddress);
        if (!snapshot) {
            return res.status(404).json({ msj: "Loteria no encontrada" });
        }

        const list = Array.isArray(snapshot.lostByReferral) ? snapshot.lostByReferral : [];
        const totalItems = list.length;
        const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 0;
        const start = (page - 1) * limit;
        const end = start + limit;
        const paged = list.slice(start, end);

        return res.status(200).json({
            ...snapshot,
            lostByReferral: paged,
            pagination: {
                page,
                limit,
                totalItems,
                totalPages
            }
        });
    } catch (error) {
        console.error("Error calculating lost earnings by lottery:", error);
        return res.status(500).json({ msj: "Error calculando ganancias perdidas" });
    }
};

// Desvincular wallet
exports.removeWallet = async (req, res) => {
    try {
        const userId = req.user.id;
        const walletToRemove = toWallet(req.params.wallet);

        if (!walletToRemove) {
            return res.status(400).json({ msj: "Wallet inválida" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ msj: "Usuario no encontrado" });
        }

        // Verificar si la wallet pertenece al usuario
        const walletIndex = user.wallets.findIndex(w => toWallet(w) === walletToRemove);
        if (walletIndex === -1) {
            return res.status(404).json({ msj: "La wallet no está vinculada a esta cuenta" });
        }

        // Opcional: Impedir eliminar si es la única y no tiene otro método de acceso
        // Por ahora permitimos eliminar siempre que quede al menos 1 wallet O tenga email/password
        // Pero el requerimiento fue solo "permitir desvincular".
        // Si tiene solo 1 wallet y no tiene email, podría quedar inaccesible.
        // Vamos a asumir que el frontend maneja la advertencia, o validamos aquí:
        /*
        if (user.wallets.length === 1 && (!user.email || !user.password)) {
             return res.status(400).json({ msj: "No puedes desvincular tu único método de acceso." });
        }
        */

        // Remove wallet
        user.wallets.splice(walletIndex, 1);

        // Remove from sponsorships if exist? 
        // Logic: if user remove wallet, sponsorship remains but might be disconnected?
        // Let's just remove from wallets array as requested.

        await user.save();

        return res.status(200).json({
            msj: "Wallet desvinculada correctamente",
            wallets: user.wallets
        });

    } catch (error) {
        console.error("Error removeWallet:", error);
        return res.status(500).json({ msj: "Error desvinculando wallet" });
    }
};

// Obtener historial legal de usuario (para Admin Modal)
exports.getUserLegalStats = async (req, res) => {
    try {
        const { id } = req.params; // Target user ID

        // Security: requester must be admin or self? 
        // Route middleware should handle 'requireSelfOrAdmin' or 'isAdmin'.
        // Provided logic suggests this is for Admin Panel mostly.

        // 1. Fetch Acceptances
        const acceptances = await LegalAcceptance.find({ userId: id })
            .sort({ acceptedAt: -1 })
            .lean();

        if (!acceptances || acceptances.length === 0) {
            return res.status(200).json({ stats: [] });
        }

        // 2. Group by documentKey to get latest version for each type
        // Actually, user wants "historial" in modal? Or "version legal aceptada"?
        // Request: "mostrar la version legal aceptada... modal la ultima version aceptada de cada documento"
        // So we return the LATEST active acceptance per documentKey.

        const latestByDoc = new Map();

        acceptances.forEach(acc => {
            if (!latestByDoc.has(acc.documentKey)) {
                latestByDoc.set(acc.documentKey, {
                    documentKey: acc.documentKey,
                    version: acc.version,
                    acceptedAt: acc.acceptedAt,
                    ip: acc.ip,
                    source: acc.source
                });
            }
        });

        const stats = Array.from(latestByDoc.values());

        return res.status(200).json({ stats });

    } catch (error) {
        console.error("Error getUserLegalStats:", error);
        return res.status(500).json({ msj: "Error obteniendo estadísticas legales" });
    }
};
