const { getFoundingCircleContract } = require("../../services/blockchain.service");
const { ethers } = require("ethers");
const FoundingCircle = require("../../models/oddswin/foundingCircle.model.js");
const User = require("../../models/user.model");
const {
    normalizeWallet,
    syncFoundingCircleOwnersState
} = require("../../services/oddswin/foundingCircle.sync.service");

const METADATA_CID = String(process.env.CID_FOUNDING_CIRCLE_METADATA)
    .trim()
    .replace(/^ipfs:\/\//i, "")
    .replace(/^ipfs\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

const normalizeIpfsToHttp = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("ipfs://")) {
        const ipfsPath = trimmed.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "");
        return `https://ipfs.io/ipfs/${ipfsPath}`;
    }

    if (isHttpUrl(trimmed)) {
        return trimmed;
    }

    return `https://ipfs.io/ipfs/${trimmed.replace(/^\/+/, "")}`;
};

const isRecursiveMetadataUrl = (urlValue, tokenId) => {
    if (!isHttpUrl(urlValue)) return false;

    const token = String(tokenId);
    const pathMatchers = [
        `/founding-circle/metadata/${token}`,
        `/games/oddswin/founding-circle/metadata/${token}`,
        `/api/founding-circle/metadata/${token}`,
        `/api/games/oddswin/founding-circle/metadata/${token}`
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

    if (normalized) {
        if (!isRecursiveMetadataUrl(normalized, tokenId)) {
            candidates.push(normalized);
            if (!normalized.includes(".json") && !normalized.endsWith("/")) {
                candidates.push(`${normalized}.json`);
            }
        }
    }

    if (METADATA_CID) {
        const fallbackBase = `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}`;
        candidates.push(`${fallbackBase}.json`);
        candidates.push(fallbackBase);
    }

    return [...new Set(candidates)];
};

const resolveMetadataImage = (imageValue, metadataUrl) => {
    if (typeof imageValue !== "string" || !imageValue.trim()) return "";

    const normalized = normalizeIpfsToHttp(imageValue);
    if (isHttpUrl(normalized)) {
        return normalized;
    }

    try {
        return new URL(imageValue, metadataUrl).toString();
    } catch (_) {
        return imageValue;
    }
};

const getWalletTotalRegalias = async (wallet) => {
    const normalizedWallet = normalizeWallet(wallet);
    if (!normalizedWallet) return 0;

    const result = await FoundingCircle.aggregate([
        { $match: { owner: normalizedWallet } },
        {
            $group: {
                _id: null,
                total: {
                    $sum: {
                        $ifNull: ["$totalRegalias", 0]
                    }
                }
            }
        }
    ]);

    return Number(result?.[0]?.total || 0);
};

const resolveMetadataUrlForToken = async (contract, tokenId) => {
    try {
        const tokenUri = await contract.tokenURI(tokenId);
        const candidates = buildMetadataCandidates(tokenUri, tokenId);
        return candidates[0] || "";
    } catch (_) {
        if (!METADATA_CID) return "";
        return `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}.json`;
    }
};

exports.getMetadata = async (req, res) => {
    const { tokenId } = req.params;
    const normalizedTokenId = Number(tokenId);

    if (!tokenId || Number.isNaN(normalizedTokenId)) {
        return res.status(400).json({ error: "Token ID inválido" });
    }

    try {
        const contract = await getFoundingCircleContract();
        let tokenUri = "";

        try {
            tokenUri = await contract.tokenURI(normalizedTokenId);
        } catch (_) {
            tokenUri = "";
        }

        const metadataUrls = buildMetadataCandidates(tokenUri, normalizedTokenId);
        let metadata = null;
        let metadataSource = "";
        let lastFetchError = "";

        for (const url of metadataUrls) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    lastFetchError = `HTTP ${response.status} en ${url}`;
                    continue;
                }
                metadata = await response.json();
                metadataSource = url;
                break;
            } catch (_) {
                lastFetchError = `Error de red en ${url}`;
            }
        }

        if (!metadata) {
            throw new Error(`No se pudo obtener metadata del token. ${lastFetchError || "Sin respuesta valida de metadata."}`);
        }

        metadata.image = resolveMetadataImage(metadata.image, metadataSource);
        return res.json(metadata);
    } catch (error) {
        console.error(`Error fetching founding metadata [${tokenId}]:`, error.message);
        return res.status(500).json({
            error: "Error obteniendo metadata",
            details: error.message
        });
    }
};

exports.getGlobalInfo = async (_req, res) => {
    try {
        const contract = await getFoundingCircleContract();

        const [activeSupply, maxSlots, price, threshold] = await Promise.all([
            contract.activeSupply(),
            contract.maxSlots(),
            contract.nftPrice(),
            contract.boxThreshold()
        ]);

        return res.status(200).json({
            success: true,
            data: {
                activeSupply: Number(activeSupply),
                maxSlots: Number(maxSlots),
                price: ethers.formatEther(price),
                boxThreshold: Number(threshold),
                contractAddress: contract.target
            }
        });
    } catch (error) {
        console.error("Error obteniendo info global Founding Circle:", error);
        return res.status(500).json({ success: false, message: "Error conectando con Blockchain" });
    }
};

exports.getUserInfo = async (req, res) => {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
        return res.status(400).json({ success: false, message: "Dirección de billetera inválida" });
    }

    try {
        const normalizedAddress = normalizeWallet(address);
        const snapshot = await syncFoundingCircleOwnersState();
        const items = (snapshot.tokens || []).filter((item) => item.owner === normalizedAddress);
        const holderSummary = (snapshot.holders || []).find((holder) => holder.owner === normalizedAddress);
        const totalRegalias = await getWalletTotalRegalias(normalizedAddress);
        const normalizedRegalias = Number(totalRegalias || holderSummary?.totalRegalias || 0);

        return res.status(200).json({
            success: true,
            hasNft: items.length > 0,
            data: items,
            summary: {
                isOwner: items.length > 0,
                nftCount: items.length,
                totalRegalias: Number.isFinite(normalizedRegalias) ? normalizedRegalias : 0
            }
        });
    } catch (error) {
        console.error(`Error obteniendo user info Founding Circle [${address}]:`, error);
        return res.status(500).json({ success: false, message: "Error de lectura en Blockchain" });
    }
};

exports.getHolders = async (_req, res) => {
    try {
        const snapshot = await syncFoundingCircleOwnersState();

        return res.status(200).json({
            success: true,
            data: {
                totalSupply: snapshot.totalSupply || 0,
                maxSlots: snapshot.maxSlots || 0,
                holders: snapshot.holders || []
            }
        });
    } catch (error) {
        console.error("Error obteniendo holders Founding Circle:", error);
        return res.status(500).json({ success: false, message: "Error obteniendo holders Founding Circle" });
    }
};

exports.recordClaim = async (req, res) => {
    const { tokenId, owner, amount } = req.body;

    if (!tokenId || !owner || amount === undefined) {
        return res.status(400).json({ success: false, message: "Faltan datos requeridos" });
    }

    try {
        const lowerOwner = normalizeWallet(owner);
        const normalizedTokenId = Number(tokenId);
        const normalizedAmount = Number(amount);

        if (!Number.isInteger(normalizedTokenId) || normalizedTokenId <= 0) {
            return res.status(400).json({ success: false, message: "tokenId inválido" });
        }

        if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
            return res.status(400).json({ success: false, message: "amount inválido" });
        }

        const authUser = await User.findById(req.user.id).select("wallets");
        if (!authUser) {
            return res.status(404).json({ success: false, message: "Usuario autenticado no encontrado" });
        }

        const userWallets = (authUser.wallets || []).map(normalizeWallet).filter(Boolean);
        const tokenWallet = normalizeWallet(req.user.wallet);
        if (!userWallets.includes(lowerOwner) && tokenWallet !== lowerOwner) {
            return res.status(403).json({ success: false, message: "No puedes registrar claims para otra wallet" });
        }

        const contract = await getFoundingCircleContract();
        let chainOwner;
        try {
            chainOwner = normalizeWallet(await contract.ownerOf(normalizedTokenId));
        } catch (_) {
            return res.status(400).json({ success: false, message: "El tokenId no existe en el contrato" });
        }

        if (chainOwner !== lowerOwner) {
            return res.status(400).json({
                success: false,
                message: "La wallet enviada no es la propietaria actual del NFT on-chain"
            });
        }

        const metadataUrl = await resolveMetadataUrlForToken(contract, normalizedTokenId);

        const nftDoc = await FoundingCircle.findOneAndUpdate(
            { tokenId: normalizedTokenId, owner: lowerOwner },
            {
                $inc: { totalRegalias: normalizedAmount },
                $set: {
                    lastUpdated: new Date(),
                    ...(metadataUrl ? { metadata: metadataUrl } : {})
                },
                $setOnInsert: {
                    tokenId: normalizedTokenId,
                    owner: lowerOwner
                }
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }
        );

        const syncSnapshot = await syncFoundingCircleOwnersState().catch(() => null);
        const totalRegalias = await getWalletTotalRegalias(lowerOwner);
        const holderSummary = (syncSnapshot?.holders || []).find((holder) => holder.owner === lowerOwner);
        const ownerBalance = holderSummary?.tokenCount ?? Number(await contract.balanceOf(lowerOwner));

        return res.status(200).json({
            success: true,
            message: "Claim registrado correctamente",
            data: nftDoc,
            summary: {
                isOwner: ownerBalance > 0,
                nftCount: ownerBalance,
                totalRegalias: Number(totalRegalias || holderSummary?.totalRegalias || 0)
            }
        });
    } catch (error) {
        console.error("Error registrando claim Founding Circle:", error);
        return res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};
