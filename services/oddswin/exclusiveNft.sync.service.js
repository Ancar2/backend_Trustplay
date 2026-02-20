const { ethers } = require("ethers");
const { getExclusiveNftContract } = require("../blockchain.service");
const ExclusiveNFT = require("../../models/oddswin/exclusiveNFT.model");

const METADATA_CID = String(process.env.CID_EXCLUSIVE_NFT_METADATA || "")
    .trim()
    .replace(/^ipfs:\/\//i, "")
    .replace(/^ipfs\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const normalizeWallet = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const normalizeIpfsToHttp = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }

    if (trimmed.startsWith("ipfs://")) {
        const ipfsPath = trimmed.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
        return `https://ipfs.io/ipfs/${ipfsPath}`;
    }

    return `https://ipfs.io/ipfs/${trimmed.replace(/^\/+/, "")}`;
};

const isRecursiveMetadataUrl = (urlValue, tokenId) => {
    if (typeof urlValue !== "string" || !/^https?:\/\//i.test(urlValue)) return false;
    const token = String(tokenId);
    const pathMatchers = [
        `/exclusive-nft/metadata/${token}`,
        `/games/oddswin/exclusive-nft/metadata/${token}`,
        `/api/exclusive-nft/metadata/${token}`,
        `/api/games/oddswin/exclusive-nft/metadata/${token}`
    ];

    try {
        const parsed = new URL(urlValue);
        const path = parsed.pathname.toLowerCase();
        return pathMatchers.some((match) => path.endsWith(match));
    } catch (_) {
        const lower = urlValue.toLowerCase();
        return pathMatchers.some((match) => lower.includes(match));
    }
};

const buildMetadataCandidates = (tokenUri, tokenId) => {
    const candidates = [];
    const normalized = normalizeIpfsToHttp(tokenUri);

    if (normalized && !isRecursiveMetadataUrl(normalized, tokenId)) {
        candidates.push(normalized);
        if (!normalized.endsWith(".json") && !normalized.endsWith("/")) {
            candidates.push(`${normalized}.json`);
        }
    }

    if (METADATA_CID) {
        const fallbackBase = `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}`;
        candidates.push(`${fallbackBase}.json`);
        candidates.push(fallbackBase);
    }

    return [...new Set(candidates)];
};

const resolveMetadataUrlForToken = async (nftContract, tokenId) => {
    try {
        const tokenUri = await nftContract.tokenURI(tokenId);
        const candidates = buildMetadataCandidates(tokenUri, tokenId);
        return candidates[0] || "";
    } catch (_) {
        if (!METADATA_CID) return "";
        return `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}.json`;
    }
};

const roundTo18 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Number(parsed.toFixed(18));
};

const syncExclusiveNftOwnersState = async () => {
    const nftContract = await getExclusiveNftContract();
    const [totalSupplyRaw, maxSlotsRaw] = await Promise.all([
        nftContract.totalSupply(),
        nftContract.maxSlots().catch(() => 0n)
    ]);
    const totalSupply = Number(totalSupplyRaw || 0n);
    const maxSlots = Number(maxSlotsRaw || 0n);
    const now = new Date();
    const tokens = [];

    for (let tokenId = 1; tokenId <= totalSupply; tokenId += 1) {
        let owner = "";
        try {
            owner = normalizeWallet(await nftContract.ownerOf(tokenId));
        } catch (_) {
            continue;
        }

        if (!owner) continue;

        const [timeRemainingRaw, pendingRewardsRaw, metadataUrl] = await Promise.all([
            nftContract.getTimeRemaining(tokenId).catch(() => 0n),
            nftContract.getPendingReward(tokenId).catch(() => 0n),
            resolveMetadataUrlForToken(nftContract, tokenId).catch(() => "")
        ]);

        const pendingRewards = ethers.formatEther(pendingRewardsRaw || 0n);
        const pendingRewardsNumber = roundTo18(pendingRewards);

        tokens.push({
            tokenId,
            owner,
            metadata: metadataUrl || "",
            timeRemainingSeconds: Number(timeRemainingRaw || 0n),
            pendingRewards,
            pendingRewardsNumber,
            daysRemaining: Math.floor(Number(timeRemainingRaw || 0n) / 86400)
        });
    }

    if (tokens.length > 0) {
        await ExclusiveNFT.bulkWrite(
            tokens.map((item) => ({
                updateOne: {
                    filter: { tokenId: item.tokenId, owner: item.owner },
                    update: {
                        $set: {
                            owner: item.owner,
                            metadata: item.metadata,
                            pendingRewards: item.pendingRewards,
                            timeRemainingSeconds: item.timeRemainingSeconds,
                            lastUpdated: now
                        },
                        $setOnInsert: {
                            tokenId: item.tokenId
                        }
                    },
                    upsert: true
                }
            })),
            { ordered: false }
        );

        await ExclusiveNFT.bulkWrite(
            tokens.map((item) => ({
                updateMany: {
                    filter: { tokenId: item.tokenId, owner: { $ne: item.owner } },
                    update: {
                        $set: {
                            pendingRewards: "0",
                            timeRemainingSeconds: 0,
                            lastUpdated: now
                        }
                    }
                }
            })),
            { ordered: false }
        );
    }

    const owners = [...new Set(tokens.map((item) => item.owner))];
    const regaliasByOwner = {};

    if (owners.length > 0) {
        const regaliasResult = await ExclusiveNFT.aggregate([
            { $match: { owner: { $in: owners } } },
            {
                $group: {
                    _id: "$owner",
                    totalRegalias: {
                        $sum: {
                            $ifNull: ["$totalRegalias", 0]
                        }
                    }
                }
            }
        ]);

        regaliasResult.forEach((row) => {
            regaliasByOwner[row._id] = roundTo18(row.totalRegalias || 0);
        });
    }

    const holdersMap = new Map();
    tokens.forEach((item) => {
        if (!holdersMap.has(item.owner)) {
            holdersMap.set(item.owner, {
                owner: item.owner,
                tokenIds: [],
                tokenCount: 0,
                pendingRewards: 0,
                totalRegalias: regaliasByOwner[item.owner] || 0
            });
        }

        const current = holdersMap.get(item.owner);
        current.tokenIds.push(item.tokenId);
        current.tokenCount += 1;
        current.pendingRewards = roundTo18(current.pendingRewards + item.pendingRewardsNumber);
    });

    const holders = [...holdersMap.values()]
        .map((holder) => ({
            ...holder,
            tokenIds: holder.tokenIds.sort((a, b) => a - b),
            pendingRewards: roundTo18(holder.pendingRewards),
            totalRegalias: roundTo18(holder.totalRegalias)
        }))
        .sort((a, b) => b.pendingRewards - a.pendingRewards);

    return {
        totalSupply,
        maxSlots,
        holders,
        tokens
    };
};

module.exports = {
    normalizeWallet,
    syncExclusiveNftOwnersState
};
