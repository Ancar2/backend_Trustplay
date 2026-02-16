const { ethers } = require("ethers");
const { getProvider, CONTRACTS } = require("../blockchain.service");
const Lottery = require("../../models/oddswin/lottery.model");
const Box = require("../../models/oddswin/box.model");
const ReconcileState = require("../../models/system/reconcileState.model");
const GlobalConfig = require("../../models/oddswin/globalConfig.model");

const RECONCILE_KEY = "oddswin_tickets_assigned";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const TICKETS_ASSIGNED_TOPIC = ethers.id("TicketsAssigned(address,uint256,uint128,uint128)");
const FACTORY_NEW_LOTTERY_TOPIC = ethers.id("NewLottery(address)");
const FACTORY_LOTTERY_CREATED_TOPIC = ethers.id("LotteryCreated(address)");

const ticketsInterface = new ethers.Interface([
    "event TicketsAssigned(address indexed e_buyer, uint256 indexed e_boxId, uint128 e_ticket1, uint128 e_ticket2)"
]);

const factoryInterface = new ethers.Interface([
    "function createLottery(string,string,uint128,address,uint128,uint256,uint256,tuple(uint128 boxes1,uint128 percentage1,uint128 boxes2,uint128 percentage2,uint128 boxes3,uint128 percentage3),uint256,uint256,uint256)",
    "function getLotteriesCount(uint256) view returns (uint256)",
    "function getLotteryAddress(uint256,uint256) view returns (address)",
    "event NewLottery(address indexed e_lotteryAddress)",
    "event LotteryCreated(address indexed lottery)"
]);

const FACTORY_READ_ABI = [
    "function getLotteriesCount(uint256) view returns (uint256)",
    "function getLotteryAddress(uint256,uint256) view returns (address)"
];

const LOTTERY_READ_ABI = [
    "function infoLottery() view returns (tuple(address stableCoin, uint128 boxPrice, uint128 boxesSold, uint128 totalBoxes, uint128 winningNumber))",
    "function infoIncentiveMaxBuyer() view returns (tuple(uint128 boxes1, uint128 percentage1, uint128 boxes2, uint128 percentage2, uint128 boxes3, uint128 percentage3))",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function completed() view returns (bool)"
];

const ERC20_READ_ABI = ["function decimals() view returns (uint8)"];

let schedulerStarted = false;
let cancelRequestedInMemory = false;

const toInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback) => {
    const parsed = toInt(value, fallback);
    return parsed > 0 ? parsed : fallback;
};

const CANCEL_MESSAGE = "Reconciliacion cancelada por solicitud manual";

const isManualCancelError = (error) => (
    Boolean(error)
    && typeof error.message === "string"
    && error.message.includes(CANCEL_MESSAGE)
);

const withTimeoutAndCancel = (promise, timeoutMs, timeoutMessage) => {
    let timeoutId = null;
    let cancelIntervalId = null;
    const operationPromise = Promise.resolve(promise);

    // Evita unhandled rejection si el race termina por cancelacion/timeout.
    operationPromise.catch(() => { });

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    const cancelPromise = new Promise((_, reject) => {
        if (cancelRequestedInMemory) {
            reject(new Error(CANCEL_MESSAGE));
            return;
        }

        cancelIntervalId = setInterval(() => {
            if (!cancelRequestedInMemory) return;
            clearInterval(cancelIntervalId);
            reject(new Error(CANCEL_MESSAGE));
        }, 100);
    });

    return Promise.race([operationPromise, timeoutPromise, cancelPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
        if (cancelIntervalId) clearInterval(cancelIntervalId);
    });
};

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAddress = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!ethers.isAddress(trimmed)) return "";
    return trimmed.toLowerCase();
};

const ensureStateDocument = async () => {
    await ReconcileState.updateOne(
        { key: RECONCILE_KEY },
        {
            $setOnInsert: {
                key: RECONCILE_KEY,
                lastProcessedBlock: 0,
                cancelRequested: false
            }
        },
        { upsert: true }
    );
};

const acquireLock = async () => {
    await ensureStateDocument();
    cancelRequestedInMemory = false;

    const now = new Date();
    const lockMinutes = toPositiveInt(process.env.RECONCILE_LOCK_MINUTES, 10);
    const lockUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);

    return ReconcileState.findOneAndUpdate(
        {
            key: RECONCILE_KEY,
            $or: [
                { isRunning: false },
                { isRunning: { $exists: false } },
                { lockUntil: null },
                { lockUntil: { $lte: now } }
            ]
        },
        {
            $set: {
                isRunning: true,
                cancelRequested: false,
                cancelRequestedAt: null,
                lockUntil,
                lastRunAt: now
            }
        },
        { new: true }
    );
};

const releaseLock = async ({ success, canceled = false, report, errorMessage, lastProcessedBlock }) => {
    const updates = {
        isRunning: false,
        cancelRequested: false,
        cancelRequestedAt: null,
        lockUntil: null,
        lastError: canceled
            ? "Reconciliacion cancelada por solicitud manual"
            : (success ? "" : String(errorMessage || "Error desconocido")),
        lastReport: report || {}
    };

    if (success && !canceled) {
        updates.lastSuccessAt = new Date();
        if (Number.isInteger(lastProcessedBlock) && lastProcessedBlock >= 0) {
            updates.lastProcessedBlock = lastProcessedBlock;
        }
    }

    await ReconcileState.updateOne({ key: RECONCILE_KEY }, { $set: updates });
    cancelRequestedInMemory = false;
};

const persistRunningReport = async (report) => {
    await ReconcileState.updateOne(
        { key: RECONCILE_KEY, isRunning: true },
        { $set: { lastReport: report } }
    );
};

const shouldStopReconciliation = async () => {
    if (cancelRequestedInMemory) return true;

    const state = await ReconcileState.findOne({ key: RECONCILE_KEY }).select("cancelRequested").lean();
    const requested = Boolean(state?.cancelRequested);
    if (requested) cancelRequestedInMemory = true;
    return requested;
};

const computeRange = async (provider, options = {}) => {
    const state = await ReconcileState.findOne({ key: RECONCILE_KEY }).lean();

    const confirmations = toPositiveInt(
        options.confirmations,
        toPositiveInt(process.env.RECONCILE_CONFIRMATIONS, 6)
    );
    const maxRange = toPositiveInt(
        options.maxRange,
        toPositiveInt(process.env.RECONCILE_MAX_RANGE, 5000)
    );
    const startBlockFromEnv = toInt(process.env.RECONCILE_START_BLOCK, 0);

    const latestBlock = await provider.getBlockNumber();
    const safeToBlock = Math.max(0, latestBlock - confirmations);
    const useLatestWindowByDefault = (
        options.source === "manual"
        && !Number.isInteger(options.fromBlock)
        && !Number.isInteger(options.toBlock)
    );

    let fromBlock = Number.isInteger(options.fromBlock)
        ? options.fromBlock
        : (useLatestWindowByDefault
            ? Math.max(0, safeToBlock - maxRange + 1)
            : (state && Number.isInteger(state.lastProcessedBlock)
                ? state.lastProcessedBlock + 1
                : startBlockFromEnv));

    fromBlock = Math.max(0, fromBlock);

    let toBlock = Number.isInteger(options.toBlock) ? options.toBlock : safeToBlock;
    toBlock = Math.min(toBlock, safeToBlock);

    if ((toBlock - fromBlock + 1) > maxRange) {
        toBlock = fromBlock + maxRange - 1;
    }

    return {
        fromBlock,
        toBlock,
        latestBlock,
        safeToBlock,
        confirmations,
        maxRange
    };
};

const getFactoryAddress = async () => {
    const envFactory = normalizeAddress(process.env.RECONCILE_FACTORY_ADDRESS || "");
    if (envFactory) return envFactory;

    try {
        const config = await GlobalConfig.findOne().select("factory").lean();
        const configFactory = normalizeAddress(config?.factory || "");
        if (configFactory) return configFactory;
    } catch (error) {
        // Fallback directo al valor estático
    }

    const defaultFactory = normalizeAddress(CONTRACTS.FACTORY || "");
    if (!defaultFactory) {
        throw new Error("No se encontro direccion valida del contrato Factory");
    }
    return defaultFactory;
};

const getYearRange = (options = {}) => {
    const currentYear = new Date().getUTCFullYear();
    let startYear = toInt(options.yearStart, toInt(process.env.RECONCILE_YEAR_START, currentYear - 5));
    let endYear = toInt(options.yearEnd, toInt(process.env.RECONCILE_YEAR_END, currentYear + 1));

    if (startYear > endYear) {
        const temp = startYear;
        startYear = endYear;
        endYear = temp;
    }

    return { startYear, endYear };
};

const readTokenDecimals = async (provider, tokenAddress) => {
    const normalizedToken = normalizeAddress(tokenAddress);
    if (!normalizedToken || normalizedToken === ZERO_ADDRESS) return 18;

    try {
        const tokenContract = new ethers.Contract(normalizedToken, ERC20_READ_ABI, provider);
        const decimals = await tokenContract.decimals();
        const parsed = Number(decimals);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : 18;
    } catch (error) {
        return 18;
    }
};

const parseCreateLotteryTx = (tx) => {
    if (!tx || typeof tx.data !== "string") return null;

    try {
        const parsed = factoryInterface.parseTransaction({
            data: tx.data,
            value: tx.value
        });

        if (!parsed || parsed.name !== "createLottery") return null;

        const incentive = parsed.args[7] || {};
        return {
            name: String(parsed.args[0] || ""),
            symbol: String(parsed.args[1] || ""),
            totalBoxes: toFiniteNumber(parsed.args[2], 0),
            stableCoin: normalizeAddress(String(parsed.args[3] || "")),
            percentageWinner: toFiniteNumber(parsed.args[5], 0),
            percentageSponsorWinner: toFiniteNumber(parsed.args[6], 0),
            percentageMostReferrals: toFiniteNumber(parsed.args[8], 0),
            percentageExclusiveNft: toFiniteNumber(parsed.args[9], 0),
            year: toFiniteNumber(parsed.args[10], 0),
            incentiveMaxBuyer: {
                boxes1: toFiniteNumber(incentive.boxes1, 0),
                percentage1: toFiniteNumber(incentive.percentage1, 0),
                boxes2: toFiniteNumber(incentive.boxes2, 0),
                percentage2: toFiniteNumber(incentive.percentage2, 0),
                boxes3: toFiniteNumber(incentive.boxes3, 0),
                percentage3: toFiniteNumber(incentive.percentage3, 0)
            }
        };
    } catch (error) {
        return null;
    }
};

const findLotteryCreationMetadata = async (provider, factoryAddress, lotteryAddress) => {
    try {
        if (await shouldStopReconciliation()) return null;

        const creationScanStartBlock = Math.max(0, toInt(process.env.RECONCILE_CREATION_SCAN_START_BLOCK, 0));
        const rpcTimeoutMs = toPositiveInt(process.env.RECONCILE_RPC_TIMEOUT_MS, 20000);
        const indexedLotteryAddress = ethers.zeroPadValue(lotteryAddress, 32);
        const logs = await withTimeoutAndCancel(
            provider.getLogs({
                address: factoryAddress,
                fromBlock: creationScanStartBlock,
                toBlock: "latest",
                topics: [
                    [FACTORY_NEW_LOTTERY_TOPIC, FACTORY_LOTTERY_CREATED_TOPIC],
                    indexedLotteryAddress
                ]
            }),
            rpcTimeoutMs,
            "Timeout consultando eventos de creacion de loteria"
        );

        if (!logs.length) return null;
        if (await shouldStopReconciliation()) return null;

        const creationLog = logs[0];
        const tx = await withTimeoutAndCancel(
            provider.getTransaction(creationLog.transactionHash),
            rpcTimeoutMs,
            "Timeout consultando transaccion de creacion de loteria"
        );
        const parsed = parseCreateLotteryTx(tx);

        return {
            creationHash: creationLog.transactionHash,
            creationBlock: toFiniteNumber(creationLog.blockNumber, 0),
            txSender: normalizeAddress(tx?.from || ""),
            ...(parsed || {})
        };
    } catch (error) {
        if (isManualCancelError(error)) throw error;
        return null;
    }
};

const readLotteryOnChainSnapshot = async (provider, lotteryAddress) => {
    const lotteryContract = new ethers.Contract(lotteryAddress, LOTTERY_READ_ABI, provider);

    const [infoRaw, incentiveRaw, name, symbol, completed] = await Promise.all([
        lotteryContract.infoLottery().catch(() => null),
        lotteryContract.infoIncentiveMaxBuyer().catch(() => null),
        lotteryContract.name().catch(() => ""),
        lotteryContract.symbol().catch(() => ""),
        lotteryContract.completed().catch(() => false)
    ]);

    const stableCoin = normalizeAddress(String(infoRaw?.stableCoin || "")) || ZERO_ADDRESS;
    const boxPriceRaw = infoRaw?.boxPrice ?? 0n;
    const boxPriceDecimals = await readTokenDecimals(provider, stableCoin);
    const boxPrice = toFiniteNumber(ethers.formatUnits(boxPriceRaw, boxPriceDecimals), 0);

    return {
        name: typeof name === "string" ? name : "",
        symbol: typeof symbol === "string" ? symbol : "",
        stableCoin,
        boxPrice,
        totalBoxes: toFiniteNumber(infoRaw?.totalBoxes, 0),
        boxesSold: toFiniteNumber(infoRaw?.boxesSold, 0),
        winningNumber: toFiniteNumber(infoRaw?.winningNumber, 0),
        completed: Boolean(completed),
        incentiveMaxBuyer: {
            boxes1: toFiniteNumber(incentiveRaw?.boxes1, 0),
            percentage1: toFiniteNumber(incentiveRaw?.percentage1, 0),
            boxes2: toFiniteNumber(incentiveRaw?.boxes2, 0),
            percentage2: toFiniteNumber(incentiveRaw?.percentage2, 0),
            boxes3: toFiniteNumber(incentiveRaw?.boxes3, 0),
            percentage3: toFiniteNumber(incentiveRaw?.percentage3, 0)
        }
    };
};

const discoverOnChainLotteries = async (provider, factoryAddress, options = {}) => {
    const onDiscoverProgress = typeof options.onDiscoverProgress === "function"
        ? options.onDiscoverProgress
        : null;
    const publishDiscoverProgress = async (payload) => {
        if (!onDiscoverProgress) return;
        try {
            await onDiscoverProgress(payload);
        } catch (error) {
            // Evita romper reconciliacion por errores de telemetria/progreso.
        }
    };

    const targetLotteryAddress = normalizeAddress(options.lotteryAddress || "");
    if (targetLotteryAddress) {
        await publishDiscoverProgress({
            mode: "single-lottery",
            scannedYears: 1,
            totalYears: 1,
            currentYear: null,
            detected: 1
        });
        return [{ address: targetLotteryAddress, year: 0, index: 0 }];
    }

    const factoryContract = new ethers.Contract(factoryAddress, FACTORY_READ_ABI, provider);
    const { startYear, endYear } = getYearRange(options);
    const discovered = new Map();
    const rpcTimeoutMs = toPositiveInt(process.env.RECONCILE_RPC_TIMEOUT_MS, 20000);
    const totalYears = Math.max(0, endYear - startYear + 1);
    let scannedYears = 0;

    for (let year = startYear; year <= endYear; year += 1) {
        if (await shouldStopReconciliation()) {
            break;
        }

        let lotteriesCount = 0;
        try {
            const countOnChain = await withTimeoutAndCancel(
                factoryContract.getLotteriesCount(year),
                rpcTimeoutMs,
                `Timeout consultando cantidad de loterias para el anio ${year}`
            );
            lotteriesCount = toFiniteNumber(countOnChain, 0);
        } catch (error) {
            if (isManualCancelError(error)) throw error;
            scannedYears += 1;
            await publishDiscoverProgress({
                mode: "range-scan",
                currentYear: year,
                scannedYears,
                totalYears,
                detected: discovered.size,
                timedOut: true
            });
            continue;
        }

        if (lotteriesCount > 0) {
            for (let index = 1; index <= lotteriesCount; index += 1) {
                if (await shouldStopReconciliation()) {
                    break;
                }

                try {
                    const lotteryAddress = normalizeAddress(await withTimeoutAndCancel(
                        factoryContract.getLotteryAddress(index, year),
                        rpcTimeoutMs,
                        `Timeout consultando loteria ${year}-${index}`
                    ));
                    if (!lotteryAddress || lotteryAddress === ZERO_ADDRESS) continue;

                    if (!discovered.has(lotteryAddress)) {
                        discovered.set(lotteryAddress, { address: lotteryAddress, year, index });
                    }
                } catch (error) {
                    if (isManualCancelError(error)) throw error;
                    // Ignorar loterías corruptas y continuar
                }
            }
        }

        scannedYears += 1;
        await publishDiscoverProgress({
            mode: "range-scan",
            currentYear: year,
            scannedYears,
            totalYears,
            detected: discovered.size,
            timedOut: false
        });
    }

    return Array.from(discovered.values());
};

const buildIncentiveMaxBuyer = (primary, fallback) => ({
    boxes1: toFiniteNumber(primary?.boxes1, toFiniteNumber(fallback?.boxes1, 0)),
    percentage1: toFiniteNumber(primary?.percentage1, toFiniteNumber(fallback?.percentage1, 0)),
    boxes2: toFiniteNumber(primary?.boxes2, toFiniteNumber(fallback?.boxes2, 0)),
    percentage2: toFiniteNumber(primary?.percentage2, toFiniteNumber(fallback?.percentage2, 0)),
    boxes3: toFiniteNumber(primary?.boxes3, toFiniteNumber(fallback?.boxes3, 0)),
    percentage3: toFiniteNumber(primary?.percentage3, toFiniteNumber(fallback?.percentage3, 0))
});

const syncLotteriesFromBlockchain = async (provider, report, options = {}) => {
    const onlyLotteriesMode = Boolean(options.onlyLotteries);
    const onLotteriesSyncProgress = typeof options.onLotteriesSyncProgress === "function"
        ? options.onLotteriesSyncProgress
        : null;
    const publishLotteriesSyncProgress = async (payload) => {
        if (!onLotteriesSyncProgress) return;
        try {
            await onLotteriesSyncProgress(payload);
        } catch (error) {
            // Evita romper reconciliacion por errores de telemetria/progreso.
        }
    };

    const factoryAddress = await getFactoryAddress();
    const onChainLotteries = await discoverOnChainLotteries(provider, factoryAddress, options);
    const historicalBackfillMap = new Map();
    const currentYear = new Date().getUTCFullYear();

    report.factoryAddress = factoryAddress;
    report.loteriasOnChainDetectadas = onChainLotteries.length;
    await publishLotteriesSyncProgress({
        processed: 0,
        total: onChainLotteries.length,
        detected: onChainLotteries.length,
        inserted: report.loteriasInsertadas,
        updated: report.loteriasActualizadas
    });

    let processedLotteries = 0;
    for (const chainLottery of onChainLotteries) {
        if (await shouldStopReconciliation()) {
            return {
                historicalBackfillMap,
                canceled: true
            };
        }

        const lotteryAddress = chainLottery.address;
        const existingLottery = await Lottery.findOne({ address: lotteryAddress }).lean();
        const normalizedYear = toFiniteNumber(chainLottery.year, currentYear);
        const normalizedIndex = toFiniteNumber(chainLottery.index, 0);

        if (onlyLotteriesMode && existingLottery) {
            const updates = {};
            if ((!existingLottery.year || existingLottery.year <= 0) && normalizedYear > 0) {
                updates.year = normalizedYear;
            }
            if ((!existingLottery.index || existingLottery.index <= 0) && normalizedIndex > 0) {
                updates.index = normalizedIndex;
            }
            if (Object.keys(updates).length > 0) {
                await Lottery.updateOne({ address: lotteryAddress }, { $set: updates });
                report.loteriasActualizadas += 1;
            }

            processedLotteries += 1;
            await publishLotteriesSyncProgress({
                processed: processedLotteries,
                total: onChainLotteries.length,
                detected: onChainLotteries.length,
                inserted: report.loteriasInsertadas,
                updated: report.loteriasActualizadas
            });
            continue;
        }

        const snapshot = await readLotteryOnChainSnapshot(provider, lotteryAddress);

        const shouldResolveCreationMetadata = (
            !onlyLotteriesMode
            && (
            !existingLottery
            || !existingLottery.creationHash
            || !existingLottery.name
            || !existingLottery.symbol
            || !existingLottery.year
            || !existingLottery.index
            || toFiniteNumber(existingLottery.percentageWinner, 0) <= 0
            || toFiniteNumber(existingLottery.percentageSponsorWinner, 0) <= 0
            || toFiniteNumber(existingLottery.percentageMostReferrals, 0) <= 0
            )
        );

        const creationMetadata = shouldResolveCreationMetadata
            ? await findLotteryCreationMetadata(provider, factoryAddress, lotteryAddress)
            : null;

        const resolvedYear = toFiniteNumber(
            chainLottery.year,
            toFiniteNumber(creationMetadata?.year, currentYear)
        );
        const resolvedIndex = toFiniteNumber(
            chainLottery.index,
            toFiniteNumber(creationMetadata?.index, 0)
        );
        const normalizedIncentive = buildIncentiveMaxBuyer(
            creationMetadata?.incentiveMaxBuyer,
            snapshot.incentiveMaxBuyer
        );

        if (!existingLottery) {
            const newLottery = new Lottery({
                address: lotteryAddress,
                creationHash: creationMetadata?.creationHash || "",
                year: resolvedYear,
                index: resolvedIndex,
                name: creationMetadata?.name || snapshot.name || `Loteria ${resolvedYear}-${resolvedIndex}`,
                symbol: creationMetadata?.symbol || snapshot.symbol || "LOT",
                totalBoxes: toFiniteNumber(snapshot.totalBoxes, toFiniteNumber(creationMetadata?.totalBoxes, 0)),
                boxPrice: toFiniteNumber(snapshot.boxPrice, 0),
                stableCoin: snapshot.stableCoin || creationMetadata?.stableCoin || ZERO_ADDRESS,
                percentageWinner: toFiniteNumber(creationMetadata?.percentageWinner, 0),
                percentageSponsorWinner: toFiniteNumber(creationMetadata?.percentageSponsorWinner, 0),
                percentageMostReferrals: toFiniteNumber(creationMetadata?.percentageMostReferrals, 0),
                percentageExclusiveNft: toFiniteNumber(creationMetadata?.percentageExclusiveNft, 0),
                incentiveMaxBuyer: normalizedIncentive,
                boxesSold: toFiniteNumber(snapshot.boxesSold, 0),
                winningNumber: toFiniteNumber(snapshot.winningNumber, 0),
                completed: Boolean(snapshot.completed),
                status: snapshot.completed ? "Completed" : "Active",
                owner: creationMetadata?.txSender || undefined
            });

            await newLottery.save();
            report.loteriasInsertadas += 1;

            const creationBlock = toFiniteNumber(creationMetadata?.creationBlock, 0);
            historicalBackfillMap.set(lotteryAddress, creationBlock > 0 ? creationBlock : 0);
            processedLotteries += 1;
            await publishLotteriesSyncProgress({
                processed: processedLotteries,
                total: onChainLotteries.length,
                detected: onChainLotteries.length,
                inserted: report.loteriasInsertadas,
                updated: report.loteriasActualizadas
            });
            continue;
        }

        const updates = {};
        const setIfChanged = (field, nextValue) => {
            if (nextValue === undefined || nextValue === null) return;
            const previousValue = existingLottery[field];

            if (typeof nextValue === "object") {
                const previousSerialized = JSON.stringify(previousValue || {});
                const nextSerialized = JSON.stringify(nextValue);
                if (previousSerialized !== nextSerialized) {
                    updates[field] = nextValue;
                }
                return;
            }

            if (previousValue !== nextValue) {
                updates[field] = nextValue;
            }
        };

        setIfChanged("totalBoxes", toFiniteNumber(snapshot.totalBoxes, toFiniteNumber(existingLottery.totalBoxes, 0)));
        setIfChanged("boxPrice", toFiniteNumber(snapshot.boxPrice, toFiniteNumber(existingLottery.boxPrice, 0)));
        setIfChanged("stableCoin", snapshot.stableCoin || existingLottery.stableCoin || ZERO_ADDRESS);
        setIfChanged("boxesSold", toFiniteNumber(snapshot.boxesSold, toFiniteNumber(existingLottery.boxesSold, 0)));
        setIfChanged("winningNumber", toFiniteNumber(snapshot.winningNumber, toFiniteNumber(existingLottery.winningNumber, 0)));
        setIfChanged("completed", Boolean(snapshot.completed));
        setIfChanged("status", snapshot.completed ? "Completed" : "Active");

        if ((!existingLottery.year || existingLottery.year <= 0) && resolvedYear > 0) {
            setIfChanged("year", resolvedYear);
        }
        if ((!existingLottery.index || existingLottery.index <= 0) && resolvedIndex > 0) {
            setIfChanged("index", resolvedIndex);
        }
        if (!existingLottery.name && (creationMetadata?.name || snapshot.name)) {
            setIfChanged("name", creationMetadata?.name || snapshot.name);
        }
        if (!existingLottery.symbol && (creationMetadata?.symbol || snapshot.symbol)) {
            setIfChanged("symbol", creationMetadata?.symbol || snapshot.symbol);
        }
        if (!existingLottery.creationHash && creationMetadata?.creationHash) {
            setIfChanged("creationHash", creationMetadata.creationHash);
        }
        if (!existingLottery.owner && creationMetadata?.txSender) {
            setIfChanged("owner", creationMetadata.txSender);
        }

        if (toFiniteNumber(existingLottery.percentageWinner, 0) <= 0 && creationMetadata?.percentageWinner !== undefined) {
            setIfChanged("percentageWinner", toFiniteNumber(creationMetadata.percentageWinner, 0));
        }
        if (toFiniteNumber(existingLottery.percentageSponsorWinner, 0) <= 0 && creationMetadata?.percentageSponsorWinner !== undefined) {
            setIfChanged("percentageSponsorWinner", toFiniteNumber(creationMetadata.percentageSponsorWinner, 0));
        }
        if (toFiniteNumber(existingLottery.percentageMostReferrals, 0) <= 0 && creationMetadata?.percentageMostReferrals !== undefined) {
            setIfChanged("percentageMostReferrals", toFiniteNumber(creationMetadata.percentageMostReferrals, 0));
        }
        if (toFiniteNumber(existingLottery.percentageExclusiveNft, 0) <= 0 && creationMetadata?.percentageExclusiveNft !== undefined) {
            setIfChanged("percentageExclusiveNft", toFiniteNumber(creationMetadata.percentageExclusiveNft, 0));
        }

        if (!existingLottery.incentiveMaxBuyer || Object.keys(existingLottery.incentiveMaxBuyer).length === 0) {
            setIfChanged("incentiveMaxBuyer", normalizedIncentive);
        }

        if (Object.keys(updates).length > 0) {
            await Lottery.updateOne({ address: lotteryAddress }, { $set: updates });
            report.loteriasActualizadas += 1;
        }

        processedLotteries += 1;
        await publishLotteriesSyncProgress({
            processed: processedLotteries,
            total: onChainLotteries.length,
            detected: onChainLotteries.length,
            inserted: report.loteriasInsertadas,
            updated: report.loteriasActualizadas
        });
    }

    return {
        historicalBackfillMap,
        canceled: false
    };
};

const recalculateLotteryStats = async (lotteryAddress) => {
    const lottery = await Lottery.findOne({ address: lotteryAddress }).select("boxPrice");
    if (!lottery) return null;

    const [boxesCount, uniqueOwners, topBuyerAgg] = await Promise.all([
        Box.countDocuments({ direccionLoteria: lotteryAddress }),
        Box.distinct("owner", { direccionLoteria: lotteryAddress }),
        Box.aggregate([
            { $match: { direccionLoteria: lotteryAddress } },
            { $group: { _id: "$owner", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ])
    ]);

    const topBuyerBoxes = topBuyerAgg.length > 0 ? Number(topBuyerAgg[0].count) : 0;
    const totalRaised = boxesCount * Number(lottery.boxPrice || 0);

    await Lottery.updateOne(
        { address: lotteryAddress },
        {
            $set: {
                boxesSold: boxesCount,
                totalParticipants: uniqueOwners.length,
                totalRaised,
                topBuyerBoxes
            }
        }
    );

    return {
        boxesSold: boxesCount,
        totalParticipants: uniqueOwners.length,
        totalRaised,
        topBuyerBoxes
    };
};

const processTicketLogsRange = async ({
    provider,
    lotteryAddress,
    fromBlock,
    toBlock,
    maxRange,
    report,
    touchedLotteries
}) => {
    const rpcTimeoutMs = toPositiveInt(process.env.RECONCILE_RPC_TIMEOUT_MS, 20000);
    let cursor = fromBlock;
    while (cursor <= toBlock) {
        if (await shouldStopReconciliation()) {
            return { canceled: true };
        }

        const chunkToBlock = Math.min(cursor + maxRange - 1, toBlock);
        let logs = [];
        try {
            logs = await withTimeoutAndCancel(
                provider.getLogs({
                    address: lotteryAddress,
                    fromBlock: cursor,
                    toBlock: chunkToBlock,
                    topics: [TICKETS_ASSIGNED_TOPIC]
                }),
                rpcTimeoutMs,
                `Timeout consultando logs de tickets para ${lotteryAddress}`
            );
        } catch (error) {
            if (isManualCancelError(error)) {
                return { canceled: true };
            }
            if (await shouldStopReconciliation()) {
                return { canceled: true };
            }
            throw error;
        }

        report.logsDetectados += logs.length;

        for (const log of logs) {
            let parsed;
            try {
                parsed = ticketsInterface.parseLog(log);
            } catch (error) {
                continue;
            }

            const owner = String(parsed.args.e_buyer || "").toLowerCase();
            const boxId = Number(parsed.args.e_boxId);
            const ticket1 = Number(parsed.args.e_ticket1);
            const ticket2 = Number(parsed.args.e_ticket2);

            if (
                !owner
                || !Number.isInteger(boxId)
                || boxId < 0
                || !Number.isInteger(ticket1)
                || ticket1 < 0
                || !Number.isInteger(ticket2)
                || ticket2 < 0
            ) {
                continue;
            }

            const upsertResult = await Box.updateOne(
                { direccionLoteria: lotteryAddress, boxId },
                {
                    $setOnInsert: {
                        direccionLoteria: lotteryAddress,
                        boxId,
                        owner,
                        ticket1,
                        ticket2,
                        hashDeLaTransaccion: log.transactionHash
                    }
                },
                { upsert: true }
            );

            if (upsertResult.upsertedCount > 0) {
                report.cajasInsertadas += 1;
                touchedLotteries.add(lotteryAddress);
            } else {
                report.cajasYaExistentes += 1;
            }
        }

        cursor = chunkToBlock + 1;
    }

    return { canceled: false };
};

const runOddswinReconciliation = async (options = {}) => {
    const lock = await acquireLock();
    if (!lock) {
        throw new Error("Ya existe una reconciliacion en curso");
    }

    let report = {
        source: options.source || "manual",
        tipoEjecucion: options.onlyLotteries ? "sincronizar_loterias" : "reconciliar_cajas",
        loteriaObjetivo: normalizeAddress(options.lotteryAddress || "") || "",
        factoryAddress: "",
        fromBlock: null,
        toBlock: null,
        latestBlock: null,
        safeToBlock: null,
        confirmations: null,
        maxRange: null,
        cancelada: false,
        loteriasOnChainDetectadas: 0,
        loteriasInsertadas: 0,
        loteriasActualizadas: 0,
        loteriasConBackfillHistorico: 0,
        loteriasAnalizadas: 0,
        loteriasProcesadas: 0,
        lotteriesAnalizadas: 0,
        logsDetectados: 0,
        cajasInsertadas: 0,
        cajasYaExistentes: 0,
        loteriasRecalculadas: 0,
        loteriasSinAddress: 0,
        progresoPorcentaje: 0,
        etapa: "Iniciando"
    };

    try {
        let lastProgressPublishAt = 0;
        let lastProgressValue = -1;
        const maybePublishProgress = async (force = false) => {
            const currentProgress = toFiniteNumber(report.progresoPorcentaje, 0);
            const now = Date.now();
            if (!force && currentProgress === lastProgressValue && (now - lastProgressPublishAt) < 1500) {
                return;
            }
            lastProgressPublishAt = now;
            lastProgressValue = currentProgress;
            await persistRunningReport({ ...report });
        };
        const boundedProgress = (start, end, current, total) => {
            if (total <= 0) return Math.floor(end);
            const ratio = Math.max(0, Math.min(1, current / total));
            return Math.floor(start + ((end - start) * ratio));
        };

        const provider = getProvider();
        const range = await computeRange(provider, options);

        report = {
            ...report,
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
            latestBlock: range.latestBlock,
            safeToBlock: range.safeToBlock,
            confirmations: range.confirmations,
            maxRange: range.maxRange
        };
        report.etapa = "Sincronizando loterias on-chain";
        await maybePublishProgress(true);

        const discoveryProgressEnd = options.onlyLotteries ? 45 : 20;
        const lotteriesSyncProgressStart = discoveryProgressEnd;
        const lotteriesSyncProgressEnd = options.onlyLotteries ? 95 : 40;
        const syncOptions = {
            ...options,
            onDiscoverProgress: async (progressPayload) => {
                const scannedYears = toFiniteNumber(progressPayload?.scannedYears, 0);
                const totalYears = toFiniteNumber(progressPayload?.totalYears, 0);
                const currentYear = progressPayload?.currentYear;
                report.loteriasOnChainDetectadas = toFiniteNumber(progressPayload?.detected, report.loteriasOnChainDetectadas);
                if (progressPayload?.mode === "single-lottery") {
                    report.etapa = "Loteria objetivo detectada";
                } else if (typeof currentYear === "number") {
                    report.etapa = `Descubriendo loterias (${scannedYears}/${totalYears}) - Anio ${currentYear}`;
                } else {
                    report.etapa = `Descubriendo loterias (${scannedYears}/${totalYears})`;
                }
                report.progresoPorcentaje = boundedProgress(0, discoveryProgressEnd, scannedYears, totalYears);
                await maybePublishProgress();
            },
            onLotteriesSyncProgress: async (progressPayload) => {
                const processed = toFiniteNumber(progressPayload?.processed, 0);
                const total = toFiniteNumber(progressPayload?.total, 0);
                report.loteriasOnChainDetectadas = toFiniteNumber(progressPayload?.detected, report.loteriasOnChainDetectadas);
                report.etapa = options.onlyLotteries
                    ? `Registrando loterias en base de datos (${processed}/${total})`
                    : `Sincronizando loterias on-chain (${processed}/${total})`;
                report.progresoPorcentaje = boundedProgress(
                    lotteriesSyncProgressStart,
                    lotteriesSyncProgressEnd,
                    processed,
                    total
                );
                await maybePublishProgress();
            }
        };

        const { historicalBackfillMap, canceled: cancelDuringLotterySync } = await syncLotteriesFromBlockchain(provider, report, syncOptions);
        let reconciliationCanceled = cancelDuringLotterySync;

        if (reconciliationCanceled) {
            report.cancelada = true;
            report.msj = "Reconciliacion cancelada por solicitud manual";
            report.etapa = "Cancelada";
            await maybePublishProgress(true);
            await releaseLock({
                success: false,
                canceled: true,
                report,
                errorMessage: "Reconciliacion cancelada por solicitud manual"
            });
            return report;
        }

        if (options.onlyLotteries) {
            report.progresoPorcentaje = 100;
            report.etapa = "Completada";
            report.msj = (
                report.loteriasInsertadas > 0 || report.loteriasActualizadas > 0
            )
                ? "Sincronizacion de loterias completada"
                : "No se detectaron cambios de loterias";
            await maybePublishProgress(true);
            await releaseLock({
                success: true,
                report,
                // Este modo no procesa bloques de tickets, conserva el cursor previo.
                lastProcessedBlock: toFiniteNumber(lock.lastProcessedBlock, 0)
            });
            return report;
        }

        const lotteriesFilter = report.loteriaObjetivo
            ? { address: report.loteriaObjetivo }
            : {};
        const lotteries = await Lottery.find(lotteriesFilter).select("address").lean();
        report.lotteriesAnalizadas = lotteries.length;
        report.loteriasAnalizadas = lotteries.length;
        report.etapa = "Sincronizando cajas";
        await maybePublishProgress(true);

        const touchedLotteries = new Set();
        const baseFromBlock = range.fromBlock;
        const hasCurrentRange = baseFromBlock <= range.toBlock;
        const totalLotteriesToScan = lotteries.length;
        let processedLotteries = 0;

        const updateLotteryProgress = async (force = false) => {
            report.loteriasProcesadas = processedLotteries;
            if (totalLotteriesToScan <= 0) {
                report.progresoPorcentaje = reconciliationCanceled ? 0 : 99;
            } else {
                report.progresoPorcentaje = Math.min(
                    99,
                    Math.floor((processedLotteries / totalLotteriesToScan) * 100)
                );
            }
            await maybePublishProgress(force);
        };

        for (const lottery of lotteries) {
            if (reconciliationCanceled || await shouldStopReconciliation()) {
                reconciliationCanceled = true;
                break;
            }

            if (!lottery.address || typeof lottery.address !== "string") {
                report.loteriasSinAddress += 1;
                processedLotteries += 1;
                await updateLotteryProgress();
                continue;
            }

            const lotteryAddress = lottery.address.toLowerCase();
            const historicalFromBlock = historicalBackfillMap.get(lotteryAddress);

            let lotteryFromBlock = baseFromBlock;
            if (Number.isInteger(historicalFromBlock) && historicalFromBlock >= 0) {
                lotteryFromBlock = Math.min(lotteryFromBlock, historicalFromBlock);
                if (!hasCurrentRange || historicalFromBlock < baseFromBlock) {
                    report.loteriasConBackfillHistorico += 1;
                }
            }

            if (lotteryFromBlock > range.toBlock) {
                processedLotteries += 1;
                await updateLotteryProgress();
                continue;
            }

            const processResult = await processTicketLogsRange({
                provider,
                lotteryAddress,
                fromBlock: lotteryFromBlock,
                toBlock: range.toBlock,
                maxRange: range.maxRange,
                report,
                touchedLotteries
            });

            if (processResult.canceled) {
                reconciliationCanceled = true;
                break;
            }

            processedLotteries += 1;
            await updateLotteryProgress();
        }

        report.etapa = "Recalculando estadisticas";
        await maybePublishProgress(true);
        for (const lotteryAddress of touchedLotteries) {
            await recalculateLotteryStats(lotteryAddress);
            report.loteriasRecalculadas += 1;
        }

        if (reconciliationCanceled) {
            report.cancelada = true;
            report.msj = "Reconciliacion cancelada por solicitud manual";
            report.etapa = "Cancelada";
        } else if (range.fromBlock > range.toBlock && report.logsDetectados === 0) {
            report.msj = (
                report.loteriasInsertadas > 0 || report.loteriasActualizadas > 0
            )
                ? "Reconciliacion completada (loterias sincronizadas, sin bloques nuevos)"
                : "No hay bloques nuevos para reconciliar";
            report.progresoPorcentaje = 100;
            report.etapa = "Completada";
        } else {
            report.msj = "Reconciliacion completada";
            report.progresoPorcentaje = 100;
            report.etapa = "Completada";
        }
        await maybePublishProgress(true);

        const lastProcessedBlock = range.fromBlock <= range.toBlock
            ? range.toBlock
            : toFiniteNumber(lock.lastProcessedBlock, 0);

        if (reconciliationCanceled) {
            await releaseLock({
                success: false,
                canceled: true,
                report,
                errorMessage: "Reconciliacion cancelada por solicitud manual"
            });
        } else {
            await releaseLock({
                success: true,
                report,
                lastProcessedBlock
            });
        }

        return report;
    } catch (error) {
        if (isManualCancelError(error) || await shouldStopReconciliation()) {
            report.cancelada = true;
            report.msj = CANCEL_MESSAGE;

            await releaseLock({
                success: false,
                canceled: true,
                report,
                errorMessage: error.message
            });

            return report;
        }

        await releaseLock({
            success: false,
            report,
            errorMessage: error.message
        });
        throw error;
    }
};

const getOddswinReconcileStatus = async () => {
    let state = await ReconcileState.findOne({ key: RECONCILE_KEY }).lean();

    if (
        state
        && state.isRunning
        && state.lockUntil
        && new Date(state.lockUntil).getTime() <= Date.now()
    ) {
        await ReconcileState.updateOne(
            { key: RECONCILE_KEY },
            {
                $set: {
                    isRunning: false,
                    cancelRequested: false,
                    cancelRequestedAt: null,
                    lockUntil: null,
                    lastError: "Reconciliacion detenida por expiracion de lock"
                }
            }
        );

        state = {
            ...state,
            isRunning: false,
            cancelRequested: false,
            cancelRequestedAt: null,
            lockUntil: null,
            lastError: "Reconciliacion detenida por expiracion de lock"
        };
    }

    if (state?.cancelRequested) {
        cancelRequestedInMemory = true;
    } else if (!state?.isRunning) {
        cancelRequestedInMemory = false;
    }

    return state || {
        key: RECONCILE_KEY,
        lastProcessedBlock: 0,
        isRunning: false,
        cancelRequested: false
    };
};

const requestOddswinReconcileStop = async () => {
    await ensureStateDocument();

    const now = new Date();
    const updated = await ReconcileState.findOneAndUpdate(
        {
            key: RECONCILE_KEY,
            isRunning: true
        },
        {
            $set: {
                cancelRequested: true,
                cancelRequestedAt: now
            }
        },
        { new: true }
    ).lean();

    if (updated) {
        cancelRequestedInMemory = true;
    }

    return {
        accepted: Boolean(updated),
        status: updated || null
    };
};

const startOddswinReconcileScheduler = () => {
    if (schedulerStarted) return;

    const enabled = String(process.env.RECONCILE_AUTO_ENABLED || "false").toLowerCase() === "true";
    if (!enabled) return;

    const intervalMinutes = toPositiveInt(process.env.RECONCILE_INTERVAL_MINUTES, 15);
    const intervalMs = intervalMinutes * 60 * 1000;

    schedulerStarted = true;

    const execute = async () => {
        try {
            await runOddswinReconciliation({ source: "automatico" });
        } catch (error) {
            console.error("Error en reconciliacion automatica:", error.message);
        }
    };

    // Primera ejecucion diferida para no competir con el arranque.
    setTimeout(execute, 30 * 1000);
    setInterval(execute, intervalMs);
};

module.exports = {
    runOddswinReconciliation,
    getOddswinReconcileStatus,
    requestOddswinReconcileStop,
    startOddswinReconcileScheduler
};
