const { getExclusiveNftContract } = require("../../services/blockchain.service");
const { ethers } = require("ethers");
const ExclusiveNFT = require('../../models/oddswin/exclusiveNFT.model.js');
const User = require("../../models/user.model");
const {
    normalizeWallet,
    syncExclusiveNftOwnersState
} = require("../../services/oddswin/exclusiveNft.sync.service");

const METADATA_CID = String(process.env.CID_EXCLUSIVE_NFT_METADATA)
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

    // Soporta CIDs o rutas ipfs sueltas.
    return `https://ipfs.io/ipfs/${trimmed.replace(/^\/+/, "")}`;
};

const isRecursiveMetadataUrl = (urlValue, tokenId) => {
    if (!isHttpUrl(urlValue)) return false;

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

    if (normalized) {
        // Evita loop infinito cuando tokenURI apunta al mismo endpoint del backend.
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

    // Elimina duplicados sin perder el orden.
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

    const result = await ExclusiveNFT.aggregate([
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

/**
 * Retorna los metadatos de un NFT específico (Proxy a IPFS).
 * @route GET /api/exclusive-nft/metadata/:tokenId
 */
exports.getMetadata = async (req, res) => {
    const { tokenId } = req.params;
    const normalizedTokenId = Number(tokenId);

    if (!tokenId || Number.isNaN(normalizedTokenId)) {
        return res.status(400).json({ error: "Token ID inválido" });
    }

    try {
        const nftContract = getExclusiveNftContract();
        let tokenUri = "";

        try {
            tokenUri = await nftContract.tokenURI(normalizedTokenId);
        } catch (error) {
            // Fallback controlado: mantenemos compatibilidad si tokenURI falla.
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
                // Continúa al siguiente candidato.
            }
        }

        if (!metadata) {
            throw new Error(`No se pudo obtener metadata del token. ${lastFetchError || "Sin respuesta valida de metadata."}`);
        }

        metadata.image = resolveMetadataImage(metadata.image, metadataSource);

        res.json(metadata);

    } catch (error) {
        console.error(`Error fetching metadata [${tokenId}]:`, error.message);
        res.status(500).json({
            error: "Error obteniendo metadata",
            details: error.message
        });
    }
};

/**
 * Obtiene la información global del sistema de NFTs Exclusivos.
 * @route GET /api/exclusive-nft/info
 */
exports.getGlobalInfo = async (req, res) => {
    try {
        const nftContract = getExclusiveNftContract();

        // Llamadas paralelas para eficiencia
        const [activeSupply, maxSlots, price, threshold] = await Promise.all([
            nftContract.activeSupply(),
            nftContract.maxSlots(),
            nftContract.nftPrice(),
            nftContract.referralThreshold()
        ]);

        res.status(200).json({
            success: true,
            data: {
                activeSupply: Number(activeSupply),
                maxSlots: Number(maxSlots),
                price: ethers.formatEther(price), // Convertir Wei a Tokens
                referralThreshold: Number(threshold),
                contractAddress: nftContract.target
            }
        });
    } catch (error) {
        console.error("Error obteniendo info global NFT:", error);
        res.status(500).json({ success: false, message: "Error conectando con Blockchain" });
    }
};

/**
 * Obtiene la información específica de un usuario respecto al NFT.
 * Verifica si tiene NFT, su ID, tiempo restante y recompensas.
 * @route GET /api/exclusive-nft/user/:address
 */
exports.getUserInfo = async (req, res) => {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
        return res.status(400).json({ success: false, message: "Dirección de billetera inválida" });
    }

    try {
        const normalizedAddress = normalizeWallet(address);
        const syncSnapshot = await syncExclusiveNftOwnersState();
        const items = (syncSnapshot.tokens || []).filter((item) => item.owner === normalizedAddress);
        const holderSummary = (syncSnapshot.holders || []).find((holder) => holder.owner === normalizedAddress);
        const totalRegalias = await getWalletTotalRegalias(normalizedAddress);
        const normalizedRegalias = Number(totalRegalias || holderSummary?.totalRegalias || 0);

        res.status(200).json({
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
        console.error(`Error obteniendo user info NFT [${address}]:`, error);
        // Si falla por "Owner index out of bounds" u otro error RPC
        res.status(500).json({ success: false, message: "Error de lectura en Blockchain" });
    }
};

/**
 * Lista los dueños actuales de NFT exclusivo con rewards pendientes y regalías acumuladas.
 * @route GET /api/exclusive-nft/holders
 */
exports.getHolders = async (_req, res) => {
    try {
        const snapshot = await syncExclusiveNftOwnersState();

        res.status(200).json({
            success: true,
            data: {
                totalSupply: snapshot.totalSupply || 0,
                maxSlots: snapshot.maxSlots || 0,
                holders: snapshot.holders || []
            }
        });
    } catch (error) {
        console.error("Error obteniendo holders NFT exclusivo:", error);
        res.status(500).json({ success: false, message: "Error obteniendo holders NFT exclusivo" });
    }
};


/**
 * Registra un reclamo de recompensa y actualiza el acumulado.
 * Maneja cambios de ownership creando un nuevo documento si es necesario.
 * @route POST /api/exclusive-nft/claim-record
 */
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

        const nftContract = getExclusiveNftContract();
        let chainOwner;
        try {
            chainOwner = normalizeWallet(await nftContract.ownerOf(normalizedTokenId));
        } catch (_) {
            return res.status(400).json({ success: false, message: "El tokenId no existe en el contrato" });
        }

        if (chainOwner !== lowerOwner) {
            return res.status(400).json({
                success: false,
                message: "La wallet enviada no es la propietaria actual del NFT on-chain"
            });
        }

        // Actualización atómica para minimizar duplicados por concurrencia.
        const metadataUrl = await resolveMetadataUrlForToken(nftContract, normalizedTokenId);

        const nftDoc = await ExclusiveNFT.findOneAndUpdate(
            { tokenId: normalizedTokenId, owner: lowerOwner },
            {
                $inc: {
                    totalRegalias: normalizedAmount
                },
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

        const syncSnapshot = await syncExclusiveNftOwnersState().catch(() => null);
        const totalRegalias = await getWalletTotalRegalias(lowerOwner);
        const holderSummary = (syncSnapshot?.holders || []).find((holder) => holder.owner === lowerOwner);
        const ownerBalance = holderSummary?.tokenCount ?? Number(await nftContract.balanceOf(lowerOwner));

        res.status(200).json({
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
        console.error("Error registrando claim:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
};
