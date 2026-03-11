const { ethers } = require("ethers");
const { getProvider, getContractsConfig } = require("../blockchain.service");
const ExclusiveNFT = require("../../models/oddswin/exclusiveNFT.model");
const FoundingCircle = require("../../models/oddswin/foundingCircle.model");
const StatusClaimReconcileLog = require("../../models/oddswin/statusClaimReconcileLog.model");

const REWARD_CLAIM_EVENT_ABI = [
    "event RewardClaimed(uint256 tokenId, address owner, uint256 amount)"
];
const DEFAULT_LAST_BLOCKS_WINDOW = 5_000;
const MAX_MANUAL_BLOCK_WINDOW = 250_000;
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

const toOptionalInt = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
};

const toNormalizedAddress = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!ethers.isAddress(trimmed)) return "";
    return ethers.getAddress(trimmed).toLowerCase();
};

const toAmountFromTokenUnits = (amount, decimals) => {
    const safeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18;
    const parsed = Number(ethers.formatUnits(amount || 0n, safeDecimals));
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Number(parsed.toFixed(18));
};

const buildValidationError = (message) => {
    const error = new Error(message);
    error.code = "VALIDATION_ERROR";
    return error;
};

const resolveReconcileRange = async (provider, rawOptions = {}) => {
    const latestBlock = await provider.getBlockNumber();
    const mode = rawOptions.mode === "manual" ? "manual" : "last5000";

    if (mode === "last5000") {
        const fromBlock = Math.max(0, latestBlock - DEFAULT_LAST_BLOCKS_WINDOW + 1);
        return {
            mode,
            latestBlock,
            fromBlock,
            toBlock: latestBlock
        };
    }

    const fromBlock = toOptionalInt(rawOptions.fromBlock);
    const toBlock = toOptionalInt(rawOptions.toBlock);

    if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock)) {
        throw buildValidationError("En modo manual debes enviar fromBlock y toBlock.");
    }

    if (fromBlock < 0 || toBlock < 0) {
        throw buildValidationError("fromBlock y toBlock no pueden ser negativos.");
    }

    if (fromBlock > toBlock) {
        throw buildValidationError("fromBlock no puede ser mayor que toBlock.");
    }

    if (toBlock > latestBlock) {
        throw buildValidationError(`toBlock (${toBlock}) no puede ser mayor al ultimo bloque (${latestBlock}).`);
    }

    const requestedWindow = toBlock - fromBlock + 1;
    if (requestedWindow > MAX_MANUAL_BLOCK_WINDOW) {
        throw buildValidationError(
            `El rango manual supera el maximo permitido (${MAX_MANUAL_BLOCK_WINDOW} bloques).`
        );
    }

    return {
        mode,
        latestBlock,
        fromBlock,
        toBlock
    };
};

const readRewardClaimEvents = async (
    provider,
    contractAddress,
    contractType,
    fromBlock,
    toBlock,
    tokenDecimals
) => {
    if (!contractAddress) return [];

    const contract = new ethers.Contract(contractAddress, REWARD_CLAIM_EVENT_ABI, provider);
    const logs = await contract.queryFilter("RewardClaimed", fromBlock, toBlock);

    return logs
        .map((eventLog) => {
            const tokenId = Number(eventLog.args?.tokenId ?? 0n);
            const owner = toNormalizedAddress(eventLog.args?.owner ?? "");
            const amount = toAmountFromTokenUnits(eventLog.args?.amount ?? 0n, tokenDecimals);
            const txHash = String(eventLog.transactionHash || "").toLowerCase();
            const logIndex = Number(eventLog.index ?? eventLog.logIndex ?? -1);
            const blockNumber = Number(eventLog.blockNumber ?? -1);

            if (!owner || !Number.isInteger(tokenId) || tokenId <= 0 || amount <= 0) return null;
            if (!txHash || !Number.isInteger(logIndex) || logIndex < 0 || !Number.isInteger(blockNumber) || blockNumber < 0) {
                return null;
            }

            return {
                claimKey: `${contractAddress}:${txHash}:${logIndex}`,
                contractType,
                contractAddress,
                owner,
                tokenId,
                amount,
                txHash,
                logIndex,
                blockNumber,
                claimTime: null
            };
        })
        .filter(Boolean);
};

const resolveTokenDecimals = async (provider, contracts) => {
    const usdtAddress = toNormalizedAddress(contracts?.USDT || "");
    if (!usdtAddress) return 18;

    try {
        const token = new ethers.Contract(usdtAddress, ERC20_DECIMALS_ABI, provider);
        const decimals = Number(await token.decimals());
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return 18;
        return decimals;
    } catch (_) {
        return 18;
    }
};

const EPSILON = 1e-18;

const getDeltaEventsFromLogs = async (events = []) => {
    if (!Array.isArray(events) || events.length === 0) {
        return {
            deltaEvents: [],
            insertedClaims: 0,
            correctedClaims: 0,
            alreadyRegisteredClaims: 0
        };
    }

    const claimKeys = events.map((event) => event.claimKey);
    const existingRows = await StatusClaimReconcileLog.find({
        claimKey: { $in: claimKeys }
    })
        .select("claimKey amount")
        .lean();

    const existingMap = new Map(
        existingRows.map((row) => [String(row.claimKey), Number(row.amount || 0)])
    );

    const deltaEvents = [];
    const operations = events.map((event) => ({
        updateOne: {
            filter: { claimKey: event.claimKey },
            update: { $set: event },
            upsert: true
        }
    }));

    let insertedClaims = 0;
    let correctedClaims = 0;
    let alreadyRegisteredClaims = 0;

    events.forEach((event) => {
        const hasPrevious = existingMap.has(event.claimKey);
        const previousAmount = hasPrevious ? Number(existingMap.get(event.claimKey) || 0) : 0;
        const deltaAmount = Number((Number(event.amount || 0) - previousAmount).toFixed(18));
        const changed = Math.abs(deltaAmount) > EPSILON;

        if (!hasPrevious) insertedClaims += 1;
        else if (changed) correctedClaims += 1;
        else alreadyRegisteredClaims += 1;

        if (!changed) return;
        deltaEvents.push({
            ...event,
            amount: deltaAmount
        });
    });

    await StatusClaimReconcileLog.bulkWrite(operations, { ordered: false });

    return {
        deltaEvents,
        insertedClaims,
        correctedClaims,
        alreadyRegisteredClaims
    };
};

const summarizeDeltaByContract = (deltaEvents = []) => {
    let primeAmount = 0;
    let foundingAmount = 0;

    deltaEvents.forEach((event) => {
        const amount = Number(event?.amount || 0);
        if (!Number.isFinite(amount) || amount === 0) return;
        if (event.contractType === "prime") {
            primeAmount += amount;
            return;
        }
        foundingAmount += amount;
    });

    return {
        primeAmount: Number(primeAmount.toFixed(18)),
        foundingAmount: Number(foundingAmount.toFixed(18))
    };
};

const buildTouchedKeys = (events = []) => {
    const unique = new Map();

    events.forEach((event) => {
        const contractType = String(event?.contractType || "");
        const owner = toNormalizedAddress(event?.owner || "");
        const tokenId = Number(event?.tokenId || 0);
        if (!contractType || !owner || !Number.isInteger(tokenId) || tokenId <= 0) return;

        const key = `${contractType}:${owner}:${tokenId}`;
        if (!unique.has(key)) {
            unique.set(key, { contractType, owner, tokenId });
        }
    });

    return [...unique.values()];
};

const rebuildTotalsFromLogsForTouchedKeys = async (touchedKeys = []) => {
    if (!Array.isArray(touchedKeys) || touchedKeys.length === 0) {
        return {
            primeUpdates: 0,
            foundingUpdates: 0
        };
    }

    const matchOr = touchedKeys.map((item) => ({
        contractType: item.contractType,
        owner: item.owner,
        tokenId: item.tokenId
    }));

    const totalsFromLogs = await StatusClaimReconcileLog.aggregate([
        { $match: { $or: matchOr } },
        {
            $group: {
                _id: {
                    contractType: "$contractType",
                    owner: "$owner",
                    tokenId: "$tokenId"
                },
                totalAmount: { $sum: "$amount" }
            }
        }
    ]);

    const now = new Date();
    const primeOps = [];
    const foundingOps = [];

    totalsFromLogs.forEach((row) => {
        const contractType = String(row?._id?.contractType || "");
        const owner = toNormalizedAddress(row?._id?.owner || "");
        const tokenId = Number(row?._id?.tokenId || 0);
        const totalAmount = Number(row?.totalAmount || 0);
        if (!owner || !Number.isInteger(tokenId) || tokenId <= 0) return;
        if (!Number.isFinite(totalAmount) || totalAmount < 0) return;

        const operation = {
            updateOne: {
                filter: { tokenId, owner },
                update: {
                    $set: {
                        totalRegalias: Number(totalAmount.toFixed(18)),
                        lastUpdated: now
                    },
                    $setOnInsert: {
                        tokenId,
                        owner,
                        metadata: {},
                        pendingRewards: "0",
                        timeRemainingSeconds: 0
                    }
                },
                upsert: true
            }
        };

        if (contractType === "prime") {
            primeOps.push(operation);
            return;
        }

        if (contractType === "founding") {
            foundingOps.push(operation);
        }
    });

    const [primeResult, foundingResult] = await Promise.all([
        primeOps.length > 0 ? ExclusiveNFT.bulkWrite(primeOps, { ordered: false }) : Promise.resolve(null),
        foundingOps.length > 0 ? FoundingCircle.bulkWrite(foundingOps, { ordered: false }) : Promise.resolve(null)
    ]);

    return {
        primeUpdates: Number(primeResult?.modifiedCount || 0) + Number(primeResult?.upsertedCount || 0),
        foundingUpdates: Number(foundingResult?.modifiedCount || 0) + Number(foundingResult?.upsertedCount || 0)
    };
};

const runStatusClaimsReconciliation = async (options = {}) => {
    const provider = getProvider();
    const range = await resolveReconcileRange(provider, options);
    const contracts = await getContractsConfig();
    const tokenDecimals = await resolveTokenDecimals(provider, contracts);

    const primeAddress = toNormalizedAddress(options?.primeContractAddress || contracts?.EXCLUSIVE_NFT || "");
    const foundingAddress = toNormalizedAddress(options?.foundingContractAddress || contracts?.FOUNDING_CIRCLE || "");

    if (!primeAddress && !foundingAddress) {
        throw buildValidationError("No hay contratos Prime o Founding configurados para reconciliar.");
    }

    const [primeEvents, foundingEvents] = await Promise.all([
        readRewardClaimEvents(provider, primeAddress, "prime", range.fromBlock, range.toBlock, tokenDecimals),
        readRewardClaimEvents(provider, foundingAddress, "founding", range.fromBlock, range.toBlock, tokenDecimals)
    ]);

    const allEvents = [...primeEvents, ...foundingEvents];
    const matchedEvents = allEvents.length;

    const {
        deltaEvents,
        insertedClaims,
        correctedClaims,
        alreadyRegisteredClaims
    } = await getDeltaEventsFromLogs(allEvents);
    const touchedKeys = buildTouchedKeys(allEvents);
    const updates = await rebuildTotalsFromLogsForTouchedKeys(touchedKeys);
    const deltaSummary = summarizeDeltaByContract(deltaEvents);

    const report = {
        mode: range.mode,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        latestBlock: range.latestBlock,
        tokenDecimals,
        scannedEvents: matchedEvents,
        matchedEvents,
        newlyRegisteredClaims: insertedClaims,
        correctedClaims,
        alreadyRegisteredClaims,
        prime: {
            contractAddress: primeAddress || null,
            scannedEvents: primeEvents.length,
            updatedRecords: updates.primeUpdates,
            amountAdded: deltaSummary.primeAmount
        },
        founding: {
            contractAddress: foundingAddress || null,
            scannedEvents: foundingEvents.length,
            updatedRecords: updates.foundingUpdates,
            amountAdded: deltaSummary.foundingAmount
        },
        totalAmountAdded: Number((deltaSummary.primeAmount + deltaSummary.foundingAmount).toFixed(18)),
        processedAt: new Date().toISOString()
    };

    return report;
};

module.exports = {
    runStatusClaimsReconciliation
};
