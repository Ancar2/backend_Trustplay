const { ethers } = require("ethers");
const Lottery = require("../../models/oddswin/lottery.model");
const Box = require("../../models/oddswin/box.model");
const User = require("../../models/user.model");
const GlobalConfig = require("../../models/oddswin/globalConfig.model");
const { getProvider } = require("../../services/blockchain.service");
const { syncExclusiveNftOwnersState } = require("../../services/oddswin/exclusiveNft.sync.service");
const {
    getNextLiveWithCache,
    getNextFridayAt11PmBogotaIso,
    DEFAULT_TIMEZONE
} = require("../../services/oddswin/youtubeLive.service");

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toValidDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};


const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const LOTTERY_CLOSE_SYNC_ABI = [
    "function infoLottery() view returns (tuple(address stableCoin, uint128 boxPrice, uint128 boxesSold, uint128 totalBoxes, uint128 winningNumber))",
    "function completed() view returns (bool)",
    "function ticketAccountWinner() view returns (uint128,address)",
    "function topBuyer() view returns (address)",
    "function balanceOf(address owner) view returns (uint256)"
];

const FACTORY_CLOSE_SYNC_ABI = [
    "function sponsorsConctract() view returns (address)"
];

const SPONSORS_CLOSE_SYNC_ABI = [
    "function activatedSponsors(address p_lottery, address p_account) view returns (address[2])",
    "function checkActive(address p_lottery, address p_account) view returns (bool)",
    "function accountWithMaxActivatedSponsors(address p_lottery) view returns (address)"
];

const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

const toIsoOrEmpty = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const buildCanonicalYoutubeEmbedUrl = (videoIdRaw) => {
    const videoId = String(videoIdRaw || "").trim();
    if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return "";
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
};







const extractYoutubeVideoId = (rawValue) => {
    const input = String(rawValue || "").trim();
    if (!input) return "";

    if (YOUTUBE_VIDEO_ID_REGEX.test(input)) {
        return input;
    }

    let parsed;
    try {
        parsed = new URL(input);
    } catch {
        return "";
    }

    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
        const candidate = parsed.pathname.split("/").filter(Boolean)[0] || "";
        return YOUTUBE_VIDEO_ID_REGEX.test(candidate) ? candidate : "";
    }

    if (
        host === "youtube.com"
        || host === "www.youtube.com"
        || host === "m.youtube.com"
        || host === "youtube-nocookie.com"
        || host === "www.youtube-nocookie.com"
    ) {
        const videoByQuery = parsed.searchParams.get("v") || "";
        if (YOUTUBE_VIDEO_ID_REGEX.test(videoByQuery)) {
            return videoByQuery;
        }

        const parts = parsed.pathname.split("/").filter(Boolean);
        const embedIndex = parts.findIndex((item) => item === "embed" || item === "live" || item === "shorts");
        if (embedIndex >= 0 && parts[embedIndex + 1] && YOUTUBE_VIDEO_ID_REGEX.test(parts[embedIndex + 1])) {
            return parts[embedIndex + 1];
        }
    }

    return "";
};

const normalizeAddress = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
        return ethers.getAddress(trimmed).toLowerCase();
    } catch {
        return "";
    }
};

const normalizeTxHash = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? trimmed.toLowerCase() : "";
};

const topicToAddress = (topic) => {
    if (typeof topic !== "string" || topic.length < 66) return "";
    return normalizeAddress(`0x${topic.slice(-40)}`);
};

const weiToTokenNumber = (valueWei, decimals = 18) => {
    try {
        const value = Number(ethers.formatUnits(valueWei || 0n, decimals));
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
};

const toLowerOrNull = (value) => {
    const normalized = normalizeAddress(value);
    return normalized || null;
};

const resolveTopBuyerTierPercent = (lottery, recipientBoxes) => {
    const incentives = lottery.incentiveMaxBuyer || {};
    const boxes1 = toFiniteNumber(incentives.boxes1, 0);
    const boxes2 = toFiniteNumber(incentives.boxes2, Number.MAX_SAFE_INTEGER);
    const boxes3 = toFiniteNumber(incentives.boxes3, Number.MAX_SAFE_INTEGER);
    const percentage1 = toFiniteNumber(incentives.percentage1, 0);
    const percentage2 = toFiniteNumber(incentives.percentage2, 0);
    const percentage3 = toFiniteNumber(incentives.percentage3, 0);

    if (recipientBoxes <= boxes1) {
        return percentage1;
    }
    if (recipientBoxes >= boxes2 && recipientBoxes < boxes3) {
        return percentage2;
    }
    return percentage3;
};

const resolveFactoryAddress = async () => {
    const config = await GlobalConfig.findOne().select("factory").lean().catch(() => null);
    const fromConfig = normalizeAddress(config?.factory || "");
    if (fromConfig) return fromConfig;
    return "";
};

const readTokenDecimals = async (provider, tokenAddress) => {
    const normalizedToken = normalizeAddress(tokenAddress);
    if (!normalizedToken || normalizedToken === ZERO_ADDRESS) return 18;

    try {
        const tokenContract = new ethers.Contract(normalizedToken, ERC20_DECIMALS_ABI, provider);
        const decimalsRaw = await tokenContract.decimals();
        const parsed = Number(decimalsRaw);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : 18;
    } catch {
        return 18;
    }
};

const mapRolePayoutsFromReceipt = async ({
    provider,
    txHash,
    stableCoin,
    lotteryAddress,
    winnerAddress,
    winnerSponsor,
    winnerTopBuyer,
    winnerMostReferrals
}) => {
    const emptyResult = {
        winnerPrizeWei: 0n,
        sponsorPrizeWei: 0n,
        topBuyerPrizeWei: 0n,
        mostReferralsPrizeWei: 0n,
        matchedCount: 0
    };

    const normalizedTxHash = normalizeTxHash(txHash);
    if (!normalizedTxHash) return emptyResult;

    const receipt = await provider.getTransactionReceipt(normalizedTxHash);
    if (!receipt || !Array.isArray(receipt.logs)) return emptyResult;

    const normalizedStable = normalizeAddress(stableCoin);
    const normalizedLottery = normalizeAddress(lotteryAddress);
    if (!normalizedStable || !normalizedLottery) return emptyResult;

    const roleAmounts = { ...emptyResult };

    const transferLogs = receipt.logs
        .filter((log) =>
            normalizeAddress(log.address) === normalizedStable
            && String(log.topics?.[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
        )
        .map((log) => {
            let value = 0n;
            try {
                value = BigInt(log.data);
            } catch {
                value = 0n;
            }
            return {
                from: topicToAddress(log.topics?.[1]),
                to: topicToAddress(log.topics?.[2]),
                value
            };
        })
        .filter((log) => log.from === normalizedLottery && log.value > 0n);

    const payoutQueue = [];
    if (winnerAddress) payoutQueue.push({ key: "winnerPrizeWei", to: winnerAddress });
    if (winnerSponsor) payoutQueue.push({ key: "sponsorPrizeWei", to: winnerSponsor });
    if (winnerTopBuyer) payoutQueue.push({ key: "topBuyerPrizeWei", to: winnerTopBuyer });
    if (winnerMostReferrals) payoutQueue.push({ key: "mostReferralsPrizeWei", to: winnerMostReferrals });

    const usedIndexes = new Set();
    let cursor = 0;

    for (const payout of payoutQueue) {
        let matchIndex = -1;

        for (let i = cursor; i < transferLogs.length; i += 1) {
            if (transferLogs[i].to === payout.to && !usedIndexes.has(i)) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex === -1) {
            for (let i = 0; i < transferLogs.length; i += 1) {
                if (transferLogs[i].to === payout.to && !usedIndexes.has(i)) {
                    matchIndex = i;
                    break;
                }
            }
        }

        if (matchIndex === -1) {
            continue;
        }

        roleAmounts[payout.key] = transferLogs[matchIndex].value;
        usedIndexes.add(matchIndex);
        cursor = Math.max(cursor, matchIndex + 1);
        roleAmounts.matchedCount += 1;
    }

    return roleAmounts;
};

const buildOnChainCloseSnapshot = async ({ lotteryAddress, txHash }) => {
    const provider = getProvider();
    const normalizedLotteryAddress = normalizeAddress(lotteryAddress);
    if (!normalizedLotteryAddress) {
        throw new Error("Dirección de lotería inválida para sincronización on-chain.");
    }

    const lotteryContract = new ethers.Contract(normalizedLotteryAddress, LOTTERY_CLOSE_SYNC_ABI, provider);
    const [infoRaw, completedRaw] = await Promise.all([
        lotteryContract.infoLottery(),
        lotteryContract.completed()
    ]);

    const stableCoin = normalizeAddress(infoRaw?.stableCoin || "");
    const winningNumber = toFiniteNumber(infoRaw?.winningNumber, 0);
    const completed = Boolean(completedRaw);

    const snapshot = {
        winningNumber,
        completed,
        stableCoin,
        winnerAddress: null,
        winnerSponsor: null,
        winnerTopBuyer: null,
        winnerMostReferrals: null,
        topBuyerBoxes: 0,
        winnerPrize: 0,
        sponsorPrize: 0,
        topBuyerPrize: 0,
        mostReferralsPrize: 0,
        payoutFromReceipt: false
    };

    if (!completed) {
        return snapshot;
    }

    const winnerData = await lotteryContract.ticketAccountWinner().catch(() => null);
    const winnerAddress = normalizeAddress(winnerData?.[1] || "");
    snapshot.winnerAddress = winnerAddress || null;

    const topBuyerCandidate = normalizeAddress(await lotteryContract.topBuyer().catch(() => ""));
    if (topBuyerCandidate && topBuyerCandidate !== ZERO_ADDRESS) {
        const topBuyerBoxesRaw = await lotteryContract.balanceOf(topBuyerCandidate).catch(() => 0n);
        snapshot.topBuyerBoxes = toFiniteNumber(topBuyerBoxesRaw, 0);
    }

    const factoryAddress = await resolveFactoryAddress();
    if (factoryAddress) {
        const factoryContract = new ethers.Contract(factoryAddress, FACTORY_CLOSE_SYNC_ABI, provider);
        const sponsorsAddress = normalizeAddress(await factoryContract.sponsorsConctract().catch(() => ""));

        if (sponsorsAddress) {
            const sponsorsContract = new ethers.Contract(sponsorsAddress, SPONSORS_CLOSE_SYNC_ABI, provider);

            if (winnerAddress) {
                const activatedSponsors = await sponsorsContract
                    .activatedSponsors(normalizedLotteryAddress, winnerAddress)
                    .catch(() => null);
                const winnerSponsor = normalizeAddress(activatedSponsors?.[0] || "");
                snapshot.winnerSponsor = winnerSponsor || null;
            }

            if (topBuyerCandidate && topBuyerCandidate !== ZERO_ADDRESS) {
                const topBuyerIsActive = await sponsorsContract
                    .checkActive(normalizedLotteryAddress, topBuyerCandidate)
                    .catch(() => false);
                snapshot.winnerTopBuyer = topBuyerIsActive ? topBuyerCandidate : null;
            }

            const maxReferralsCandidate = normalizeAddress(
                await sponsorsContract.accountWithMaxActivatedSponsors(normalizedLotteryAddress).catch(() => "")
            );
            if (maxReferralsCandidate && maxReferralsCandidate !== ZERO_ADDRESS) {
                const maxReferralsIsActive = await sponsorsContract
                    .checkActive(normalizedLotteryAddress, maxReferralsCandidate)
                    .catch(() => false);
                snapshot.winnerMostReferrals = maxReferralsIsActive ? maxReferralsCandidate : null;
            }
        }
    }

    if (topBuyerCandidate && !snapshot.winnerTopBuyer) {
        // Si no pudimos validar sponsors, conservamos el top buyer detectado on-chain.
        snapshot.winnerTopBuyer = topBuyerCandidate;
    }

    const decimals = await readTokenDecimals(provider, stableCoin);
    const rolePayouts = await mapRolePayoutsFromReceipt({
        provider,
        txHash,
        stableCoin,
        lotteryAddress: normalizedLotteryAddress,
        winnerAddress: snapshot.winnerAddress,
        winnerSponsor: snapshot.winnerSponsor,
        winnerTopBuyer: snapshot.winnerTopBuyer,
        winnerMostReferrals: snapshot.winnerMostReferrals
    }).catch(() => null);

    if (rolePayouts) {
        snapshot.winnerPrize = weiToTokenNumber(rolePayouts.winnerPrizeWei, decimals);
        snapshot.sponsorPrize = weiToTokenNumber(rolePayouts.sponsorPrizeWei, decimals);
        snapshot.topBuyerPrize = weiToTokenNumber(rolePayouts.topBuyerPrizeWei, decimals);
        snapshot.mostReferralsPrize = weiToTokenNumber(rolePayouts.mostReferralsPrizeWei, decimals);
        snapshot.payoutFromReceipt = Number(rolePayouts.matchedCount || 0) > 0;
    }

    return snapshot;
};

// Crear nueva lotería en la base de datos de ODDSWIN (Metadata + Estado inicial)
exports.createLottery = async (req, res) => {
    try {
        const data = req.body;

        // 1. Validation
        if (!data.address || !data.stableCoin) {
            return res.status(400).json({ msj: "Faltan datos obligatorios (address, stableCoin)" });
        }

        // Validar si la lotería ya existe por dirección
        const exists = await Lottery.findOne({ address: data.address.toLowerCase() });
        if (exists) {
            return res.status(400).json({ msj: "La lotería ya existe en ODDSWIN" });
        }

        const newLottery = new Lottery({
            ...data,
            address: data.address.toLowerCase(),
            stableCoin: data.stableCoin.toLowerCase(),
            owner: data.owner ? data.owner.toLowerCase() : undefined
        });

        const saved = await newLottery.save();
        res.status(201).json(saved);

    } catch (error) {
        console.error("Error creando lotería:", error);
        res.status(500).json({ msj: "Error interno creando la lotería" });
    }
};

// Obtener listado de loterías con filtros opcionales (Año, Estado, Dueño) y Paginación
exports.getLotteries = async (req, res) => {
    try {
        const { year, status, owner, page = 1, limit = 20 } = req.query;
        let matchStage = {};

        if (year) matchStage.year = Number(year);
        if (status) matchStage.status = status;
        if (owner) matchStage.owner = owner.toLowerCase();

        const skip = (Number(page) - 1) * Number(limit);

        // Agregación para calcular topBuyer boxes en tiempo real (si es antiguo o no sincronizado)
        const lotteries = await Lottery.aggregate([
            { $match: matchStage },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: Number(limit) },
            // Lookup para buscar la box con más compras
            {
                $lookup: {
                    from: "boxes",
                    let: { lotteryAddr: "$address" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$direccionLoteria", "$$lotteryAddr"] } } },
                        { $group: { _id: "$owner", count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 1 }
                    ],
                    as: "topBuyerInfo"
                }
            },
            // Mapeamos el resultado para sobrescribir topBuyerBoxes si hay datos reales
            {
                $addFields: {
                    realTopBuyerBoxes: {
                        $ifNull: [{ $arrayElemAt: ["$topBuyerInfo.count", 0] }, "$topBuyerBoxes"]
                    }
                }
            },
            // Proyección final para asegurar que usamos el calculado
            {
                $set: {
                    topBuyerBoxes: "$realTopBuyerBoxes",
                    topBuyerInfo: "$$REMOVE",
                    realTopBuyerBoxes: "$$REMOVE"
                }
            }
        ]);

        const count = await Lottery.countDocuments(matchStage);

        res.status(200).json({
            lotteries,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalLotteries: count
        });
    } catch (error) {
        console.error("Error obteniendo loterías:", error);
        res.status(500).json({ msj: "Error interno obteniendo listado" });
    }
};

// Obtener detalle de lotería por dirección
exports.getLotteryByAddress = async (req, res) => {
    try {
        const { address } = req.params;
        const lottery = await Lottery.findOne({ address: address.toLowerCase() });

        if (!lottery) {
            return res.status(404).json({ msj: "Lotería no encontrada en ODDSWIN" });
        }
        res.status(200).json(lottery);
    } catch (error) {
        console.error("Error getLotteryByAddress:", error);
        res.status(500).json({ msj: "Error interno del servidor" });
    }
};

// Actualizar información de la lotería (Metadata off-chain)
exports.updateLotteryMetadata = async (req, res) => {
    try {
        const { address } = req.params;
        const updates = req.body;

        // Protegemos campos críticos que solo deben cambiar vía Blockchain sync
        delete updates.address;
        delete updates.boxPrice;
        delete updates.totalBoxes;

        const lottery = await Lottery.findOneAndUpdate(
            { address: address.toLowerCase() },
            { $set: updates },
            { new: true }
        );

        if (!lottery) {
            return res.status(404).json({ msj: "Lotería no encontrada para actualizar" });
        }

        res.status(200).json(lottery);

    } catch (error) {
        console.error("Error updateLotteryMetadata:", error);
        res.status(500).json({ msj: "Error interno actualizando lotería" });
    }
};

exports.announceLotteryEvent = async (req, res) => {
    try {
        const { address } = req.params;
        const { scheduledAt } = req.body || {};
        const normalizedAddress = String(address || "").toLowerCase().trim();
        const parsedDate = toValidDate(scheduledAt);

        if (!normalizedAddress) {
            return res.status(400).json({ msj: "Dirección de lotería inválida" });
        }

        if (!parsedDate) {
            return res.status(400).json({ msj: "scheduledAt inválido" });
        }

        const now = Date.now();
        if (parsedDate.getTime() <= now) {
            return res.status(400).json({ msj: "La fecha del evento debe ser futura" });
        }

        const lottery = await Lottery.findOne({ address: normalizedAddress });
        if (!lottery) {
            return res.status(404).json({ msj: "Lotería no encontrada para anunciar evento" });
        }

        const countedBoxes = await Box.countDocuments({ direccionLoteria: normalizedAddress });
        const boxesSold = Math.max(Number(lottery.boxesSold || 0), countedBoxes);
        const totalBoxes = Number(lottery.totalBoxes || 0);
        const availableBoxes = Math.max(0, totalBoxes - boxesSold);

        if (availableBoxes > 0) {
            return res.status(409).json({
                msj: "No se puede anunciar el evento: aún hay cajas disponibles",
                data: {
                    totalBoxes,
                    boxesSold,
                    availableBoxes,
                }
            });
        }

        const currentDrawEvent = lottery.drawEvent && typeof lottery.drawEvent.toObject === "function"
            ? lottery.drawEvent.toObject()
            : (lottery.drawEvent || {});

        lottery.drawEvent = {
            ...currentDrawEvent,
            announced: true,
            scheduledAt: parsedDate,
            announcedAt: new Date(),
            announcedBy: String(req.user?.wallet || req.user?.id || "admin"),
            timezone: DEFAULT_TIMEZONE,
            videoId: "",
            videoTitle: "",
            videoEmbedUrl: "",
            videoDetectedAt: null,
            resultLocked: false,
            resultLockedAt: null,
        };

        await lottery.save();

        return res.status(200).json({
            ok: true,
            msj: "Fecha y hora del evento anunciadas correctamente",
            drawEvent: lottery.drawEvent,
            lotteryAddress: lottery.address,
        });
    } catch (error) {
        console.error("Error announceLotteryEvent:", error);
        return res.status(500).json({ msj: "Error interno anunciando el evento" });
    }
};

exports.getNextLive = async (req, res) => {
    try {
        const forceRaw = String(req.query?.force || "").toLowerCase();
        const forceRefresh = forceRaw === "1" || forceRaw === "true";
        const lotteryAddress = String(req.query?.lotteryAddress || "").toLowerCase().trim();
        const hasLotteryAddress = /^0x[a-f0-9]{40}$/i.test(lotteryAddress);

        let lotteryScheduledAtIso = "";

        if (hasLotteryAddress) {
            const lottery = await Lottery.findOne({ address: lotteryAddress }).select("drawEvent");
            const drawEvent = lottery?.drawEvent && typeof lottery.drawEvent.toObject === "function"
                ? lottery.drawEvent.toObject()
                : (lottery?.drawEvent || {});

            lotteryScheduledAtIso = toIsoOrEmpty(drawEvent?.scheduledAt);
        }

        const payload = await getNextLiveWithCache({ forceRefresh });
        const response = { ...payload };
        const normalizedResponseVideoId = extractYoutubeVideoId(
            String(response.videoId || response.embedUrl || "")
        );
        const normalizedResponseEmbedUrl = buildCanonicalYoutubeEmbedUrl(normalizedResponseVideoId);

        response.videoId = normalizedResponseVideoId;
        response.embedUrl = normalizedResponseEmbedUrl;

        if (hasLotteryAddress && lotteryScheduledAtIso) {
            response.lotteryScheduledAt = lotteryScheduledAtIso;

            if (response.status !== "live") {
                response.scheduledAt = lotteryScheduledAtIso;
                if (response.status === "scheduled_only") {
                    response.source = "lottery_manual_schedule";
                } else {
                    response.source = `${response.source || "youtube"}_manual_schedule`;
                }
            }
        }



        return res.status(200).json({
            ok: true,
            status: response.status,
            scheduledAt: response.scheduledAt,
            timezone: response.timezone || DEFAULT_TIMEZONE,
            source: response.source,
            cached: !!response.cached,
            checkedAt: response.checkedAt,
            ...(normalizedResponseVideoId ? { videoId: normalizedResponseVideoId } : {}),
            ...(response.title ? { title: response.title } : {}),
            ...(normalizedResponseEmbedUrl ? { embedUrl: normalizedResponseEmbedUrl } : {}),
            ...(response.lotteryScheduledAt ? { lotteryScheduledAt: response.lotteryScheduledAt } : {}),
        });
    } catch (error) {
        console.error("Error getNextLive:", error);
        return res.status(200).json({
            ok: true,
            status: "scheduled_only",
            scheduledAt: getNextFridayAt11PmBogotaIso(),
            timezone: DEFAULT_TIMEZONE,
            source: "fallback_error",
            cached: false,
            checkedAt: new Date().toISOString(),
        });
    }
};


// Cerrar Lotería y Registrar Ganadores (Cálculo de Premios)
exports.closeLottery = async (req, res) => {
    try {
        const { address } = req.params;
        const {
            winningNumber,
            winnerAddress,
            winnerSponsor,
            winnerTopBuyer,
            winnerMostReferrals,
            finalPool,
            txHash
        } = req.body || {};

        const normalizedLotteryAddress = normalizeAddress(address);
        if (!normalizedLotteryAddress) {
            return res.status(400).json({ msj: "Dirección de lotería inválida" });
        }

        const lottery = await Lottery.findOne({ address: normalizedLotteryAddress });
        if (!lottery) {
            return res.status(404).json({ msj: "Lotería no encontrada" });
        }

        const normalizedTxHash = normalizeTxHash(txHash);
        const shouldSyncFromChain = Boolean(normalizedTxHash);

        if (lottery.completed && !shouldSyncFromChain) {
            return res.status(400).json({ msj: "La lotería ya está cerrada" });
        }

        let closeData;
        let source = "manual";

        if (shouldSyncFromChain) {
            source = "blockchain_tx";

            const chainSnapshot = await buildOnChainCloseSnapshot({
                lotteryAddress: normalizedLotteryAddress,
                txHash: normalizedTxHash
            });

            if (!chainSnapshot.completed) {
                return res.status(400).json({
                    msj: "La lotería aún no está completada on-chain. Ejecuta setWinning primero."
                });
            }

            closeData = {
                winningNumber: chainSnapshot.winningNumber,
                completed: true,
                winnerAddress: chainSnapshot.winnerAddress,
                winnerSponsor: chainSnapshot.winnerSponsor,
                winnerTopBuyer: chainSnapshot.winnerTopBuyer,
                winnerMostReferrals: chainSnapshot.winnerMostReferrals,
                topBuyerBoxes: toFiniteNumber(chainSnapshot.topBuyerBoxes, 0),
                winnerPrize: toFiniteNumber(chainSnapshot.winnerPrize, 0),
                sponsorPrize: toFiniteNumber(chainSnapshot.sponsorPrize, 0),
                topBuyerPrize: toFiniteNumber(chainSnapshot.topBuyerPrize, 0),
                mostReferralsPrize: toFiniteNumber(chainSnapshot.mostReferralsPrize, 0)
            };

            if (!chainSnapshot.payoutFromReceipt) {
                source = "blockchain_formula";

                let totalPool = 0;
                if (finalPool !== undefined && finalPool !== null) {
                    totalPool = Number(finalPool);
                    if (!Number.isFinite(totalPool) || totalPool < 0) {
                        return res.status(400).json({ msj: "finalPool inválido" });
                    }
                } else {
                    totalPool = lottery.boxesSold * lottery.boxPrice;
                }

                const percentageWinner = toFiniteNumber(lottery.percentageWinner, 0);
                const percentageSponsorWinner = toFiniteNumber(lottery.percentageSponsorWinner, 0);
                const percentageMostReferrals = toFiniteNumber(lottery.percentageMostReferrals, 0);
                const topBuyerTierPercent = resolveTopBuyerTierPercent(lottery, closeData.topBuyerBoxes);

                closeData.winnerPrize = closeData.winnerAddress
                    ? (totalPool * percentageWinner) / 10000
                    : 0;
                closeData.sponsorPrize = closeData.winnerSponsor
                    ? (totalPool * percentageSponsorWinner) / 10000
                    : 0;
                closeData.topBuyerPrize = closeData.winnerTopBuyer
                    ? (totalPool * topBuyerTierPercent) / 10000
                    : 0;
                closeData.mostReferralsPrize = closeData.winnerMostReferrals
                    ? (totalPool * percentageMostReferrals) / 10000
                    : 0;
            }
        } else {
            // Cierre manual (compatibilidad con flujo anterior)
            const normalizedWinnerAddress = normalizeAddress(winnerAddress);
            const normalizedWinnerSponsor = normalizeAddress(winnerSponsor);
            const normalizedWinnerTopBuyer = normalizeAddress(winnerTopBuyer);
            const normalizedWinnerMostReferrals = normalizeAddress(winnerMostReferrals);

            let totalPool = 0;
            if (finalPool !== undefined && finalPool !== null) {
                totalPool = Number(finalPool);
                if (!Number.isFinite(totalPool) || totalPool < 0) {
                    return res.status(400).json({ msj: "finalPool inválido" });
                }
            } else {
                console.warn(`[CloseLottery] Warning: finalPool not provided for ${normalizedLotteryAddress}. Using estimated calculation.`);
                totalPool = lottery.boxesSold * lottery.boxPrice;
            }

            const percentageWinner = toFiniteNumber(lottery.percentageWinner, 0);
            const percentageSponsorWinner = toFiniteNumber(lottery.percentageSponsorWinner, 0);
            const percentageMostReferrals = toFiniteNumber(lottery.percentageMostReferrals, 0);

            const prizeWinner = normalizedWinnerAddress
                ? (totalPool * percentageWinner) / 10000
                : 0;
            const prizeSponsor = normalizedWinnerSponsor
                ? (totalPool * percentageSponsorWinner) / 10000
                : 0;

            let recipientBoxes = 0;
            if (normalizedWinnerTopBuyer) {
                recipientBoxes = await Box.countDocuments({
                    direccionLoteria: normalizedLotteryAddress,
                    owner: normalizedWinnerTopBuyer
                });
            }

            const topBuyerTierPercent = resolveTopBuyerTierPercent(lottery, recipientBoxes);
            const prizeTopBuyer = normalizedWinnerTopBuyer
                ? (totalPool * topBuyerTierPercent) / 10000
                : 0;
            const prizeMostReferrals = normalizedWinnerMostReferrals
                ? (totalPool * percentageMostReferrals) / 10000
                : 0;

            closeData = {
                winningNumber: toFiniteNumber(winningNumber, 0),
                completed: true,
                winnerAddress: normalizedWinnerAddress || null,
                winnerSponsor: normalizedWinnerSponsor || null,
                winnerTopBuyer: normalizedWinnerTopBuyer || null,
                winnerMostReferrals: normalizedWinnerMostReferrals || null,
                topBuyerBoxes: recipientBoxes,
                winnerPrize: prizeWinner,
                sponsorPrize: prizeSponsor,
                topBuyerPrize: prizeTopBuyer,
                mostReferralsPrize: prizeMostReferrals
            };
        }

        lottery.winningNumber = toFiniteNumber(closeData.winningNumber, 0);
        lottery.completed = Boolean(closeData.completed);
        lottery.status = lottery.completed ? "Completed" : "Active";
        if (shouldSyncFromChain) {
            lottery.setWinnerTxHash = normalizedTxHash;
        }

        lottery.winnerAddress = toLowerOrNull(closeData.winnerAddress);
        lottery.winnerPrize = toFiniteNumber(closeData.winnerPrize, 0);

        lottery.winnerSponsor = toLowerOrNull(closeData.winnerSponsor);
        lottery.sponsorPrize = toFiniteNumber(closeData.sponsorPrize, 0);

        lottery.winnerTopBuyer = toLowerOrNull(closeData.winnerTopBuyer);
        lottery.topBuyerBoxes = toFiniteNumber(closeData.topBuyerBoxes, 0);
        lottery.topBuyerPrize = toFiniteNumber(closeData.topBuyerPrize, 0);

        lottery.winnerMostReferrals = toLowerOrNull(closeData.winnerMostReferrals);
        lottery.mostReferralsPrize = toFiniteNumber(closeData.mostReferralsPrize, 0);

        await lottery.save();
        let exclusiveNftSyncSummary = null;
        try {
            const nftSnapshot = await syncExclusiveNftOwnersState();
            exclusiveNftSyncSummary = {
                holders: Array.isArray(nftSnapshot?.holders) ? nftSnapshot.holders.length : 0,
                totalSupply: Number(nftSnapshot?.totalSupply || 0)
            };
        } catch (syncError) {
            console.error("Error sincronizando pendingRewards de NFT exclusivo:", syncError);
        }

        res.status(200).json({
            msj: shouldSyncFromChain
                ? "Lotería sincronizada y cerrada con datos on-chain"
                : "Lotería cerrada y premios calculados",
            source,
            ...(exclusiveNftSyncSummary ? { exclusiveNftSync: exclusiveNftSyncSummary } : {}),
            lottery
        });

    } catch (error) {
        console.error("Error closing lottery:", error);
        res.status(500).json({ msj: "Error interno cerrando la lotería" });
    }
}

// --- SENIOR PRACTICE: Sync/Maintenance Endpoints ---
/**
 * Sincroniza estadísticas vitales (Participantes, Recaudo) para todas las loterías.
 * Recalcula basándose en la data real de la colección Boxes.
 */
exports.syncLotteryStats = async (req, res) => {
    try {
        const lotteries = await Lottery.find({});

        const updates = lotteries.map(async (lottery) => {
            // 1. Recalcular Participantes Únicos
            const uniqueOwners = await Box.distinct("owner", {
                direccionLoteria: lottery.address
            });
            const participantsCount = uniqueOwners.length;

            // 2. Recalcular Boxes Vendidas (Auditoría)
            const boxesCount = await Box.countDocuments({
                direccionLoteria: lottery.address
            });

            // 3. Recalcular Recaudo (Total Raised)
            // Asumimos precio fijo actual de la lotería. Si el precio cambió en el tiempo, esto es una aproximación.
            const calculatedRaised = boxesCount * lottery.boxPrice;

            let updated = false;

            if (lottery.totalParticipants !== participantsCount) {
                lottery.totalParticipants = participantsCount;
                updated = true;
            }

            if (lottery.boxesSold !== boxesCount) {
                // Sincronizamos también boxesSold si hubiera discrepancia
                console.warn(`Discrepancia en Boxes para ${lottery.address}: DB=${lottery.boxesSold}, Real=${boxesCount}`);
                lottery.boxesSold = boxesCount;
                updated = true;
            }

            // Actualizamos totalRaised si es 0 o diferente (permitimos corrección manual, pero aquí forzamos cálculo)
            // Ojo: Si ya tenía valor, lo sobreescribimos con el cálculo "limpio".
            if (lottery.totalRaised !== calculatedRaised) {
                lottery.totalRaised = calculatedRaised;
                updated = true;
            }

            // 4. Backfill: Top Buyer Boxes (si ya hubo ganador y no tenemos el dato)
            if (lottery.winnerTopBuyer && (!lottery.topBuyerBoxes || lottery.topBuyerBoxes === 0)) {
                const recipientBoxes = await Box.countDocuments({
                    direccionLoteria: lottery.address,
                    owner: lottery.winnerTopBuyer
                });
                lottery.topBuyerBoxes = recipientBoxes;
                updated = true;
            }

            if (updated) {
                await lottery.save();
            }
        });

        await Promise.all(updates);

        res.json({
            success: true,
            message: "Sincronización de estadísticas completada (Participantes, Boxes, Recaudo).",
            totalLotteriesProcessed: lotteries.length
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Obtener Top 5 Compradores para una Lotería específica

exports.getTopBuyers = async (req, res) => {
    try {
        const { address } = req.params;

        // 1. Aggregation: Count boxes per owner for this lottery
        const topWallets = await Box.aggregate([
            { $match: { direccionLoteria: address.toLowerCase() } },
            { $group: { _id: "$owner", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        // 2. Populate Usernames
        const walletAddresses = topWallets.map(t => t._id);

        // Find users who have these wallets in their 'wallets' array
        const users = await User.find({
            wallets: { $in: walletAddresses }
        }).select("username wallets"); // Select username and wallets to match

        // Map results
        const result = topWallets.map(walletItem => {
            const walletAddr = walletItem._id;
            // Find user who owns this wallet
            const userOwner = users.find(u => u.wallets.includes(walletAddr));

            return {
                wallet: walletAddr,
                count: walletItem.count,
                username: userOwner ? userOwner.username : "Unknown"
            };
        });

        res.status(200).json(result);

    } catch (error) {
        console.error("Error getTopBuyers:", error);
        res.status(500).json({ msj: "Error al obtener top compradores" });
    }
};

// Obtener Top 5 Embajadores (Patrocinadores Directos con más cajas referidas)
exports.getTopSponsors = async (req, res) => {
    try {
        const { address } = req.params;

        // 1. Get all boxes for this lottery (to know volume)
        const boxes = await Box.find({ direccionLoteria: address.toLowerCase() }).select("owner");

        if (!boxes || boxes.length === 0) {
            return res.status(200).json([]);
        }

        // 2. Extract unique buyers
        const buyerWallets = [...new Set(boxes.map(b => b.owner))];

        // 3. Find Users for these wallets to get their sponsors
        const users = await User.find({
            wallets: { $in: buyerWallets }
        }).select("wallets sponsorships");

        // 4. Map Buyer Wallet -> Sponsor Wallet
        // We only care about DIRECT sponsors as requested
        const walletToSponsor = {};

        users.forEach(u => {
            if (u.sponsorships && u.sponsorships.length > 0) {
                u.sponsorships.forEach(s => {
                    if (s.sponsor) {
                        walletToSponsor[s.wallet.toLowerCase()] = s.sponsor.toLowerCase();
                    }
                });
            }
        });

        // 5. Aggregate Unique Active Referrals per Sponsor
        // Metric: Number of unique wallets referred that participated in this lottery
        const sponsorCounts = {};

        buyerWallets.forEach(buyerAddr => {
            const sponsor = walletToSponsor[buyerAddr];
            if (sponsor) {
                if (!sponsorCounts[sponsor]) {
                    sponsorCounts[sponsor] = 0;
                }
                sponsorCounts[sponsor]++;
            }
        });

        // 6. Convert to Array and Sort
        let sortedSponsors = Object.keys(sponsorCounts).map(sponsorAddr => ({
            wallet: sponsorAddr,
            count: sponsorCounts[sponsorAddr]
        }));

        sortedSponsors.sort((a, b) => b.count - a.count);

        // Limit to Top 5
        sortedSponsors = sortedSponsors.slice(0, 5);

        // 7. Populate Sponsor Usernames
        const sponsorWallets = sortedSponsors.map(s => s.wallet);

        const sponsorUsers = await User.find({
            wallets: { $in: sponsorWallets }
        }).select("username wallets");

        const result = sortedSponsors.map(item => {
            const userSponsor = sponsorUsers.find(u => u.wallets.includes(item.wallet));
            return {
                wallet: item.wallet,
                count: item.count,
                username: userSponsor ? userSponsor.username : "Unknown"
            };
        });

        res.status(200).json(result);

    } catch (error) {
        console.error("Error getTopSponsors:", error);
        res.status(500).json({ msj: "Error al obtener top embajadores" });
    }
};
