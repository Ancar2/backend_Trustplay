const { ethers } = require("ethers");
const GlobalConfig = require("../models/oddswin/globalConfig.model");

const RPC_URL = process.env.RPC_URL_AMOY || "https://rpc-amoy.polygon.technology/";
const provider = new ethers.JsonRpcProvider(RPC_URL);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CONFIG_CACHE_TTL_MS = Number(process.env.CONTRACT_CONFIG_CACHE_MS || 10_000);

let contractsCache = null;
let contractsCacheExpiresAt = 0;

// ABIs Mínimos (Solo lectura para funciones públicas)
const ABI_EXCLUSIVE_NFT = [
    "function activeSupply() view returns (uint256)",
    "function maxSlots() view returns (uint256)",
    "function nftPrice() view returns (uint256)",
    "function referralThreshold() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function getTimeRemaining(uint256 tokenId) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function getPendingReward(uint256 tokenId) view returns (uint256)",
    "function getLastClaimTimestamp(uint256 tokenId) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)"
];

const ABI_FACTORY = [
    "function getExclusiveNFT() view returns (address)",
    "function getAllLotteries(uint256 year) view returns (address[])"
];

const normalizeAddress = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!ethers.isAddress(trimmed)) return "";
    const normalized = ethers.getAddress(trimmed);
    return normalized === ZERO_ADDRESS ? "" : normalized;
};

const readContractsFromDb = async () => {
    const config = await GlobalConfig.findOne()
        .select("factory exclusiveNFT sponsors middleware usdt owner")
        .lean();

    return {
        FACTORY: normalizeAddress(config?.factory || ""),
        EXCLUSIVE_NFT: normalizeAddress(config?.exclusiveNFT || ""),
        SPONSORS: normalizeAddress(config?.sponsors || ""),
        MIDDLEWARE: normalizeAddress(config?.middleware || ""),
        USDT: normalizeAddress(config?.usdt || ""),
        OWNER: normalizeAddress(config?.owner || "")
    };
};

const getContractsConfig = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && contractsCache && now < contractsCacheExpiresAt) {
        return contractsCache;
    }

    const contracts = await readContractsFromDb();
    contractsCache = contracts;
    contractsCacheExpiresAt = now + Math.max(1_000, CONFIG_CACHE_TTL_MS);
    return contracts;
};

const getRequiredAddress = (contracts, key) => {
    const value = contracts?.[key];
    if (!value) {
        throw new Error(`No hay direccion configurada para ${key} en GlobalConfig`);
    }
    return value;
};

const getExclusiveNftContract = async () => {
    const contracts = await getContractsConfig();
    const address = getRequiredAddress(contracts, "EXCLUSIVE_NFT");
    return new ethers.Contract(address, ABI_EXCLUSIVE_NFT, provider);
};

const getFactoryContract = async () => {
    const contracts = await getContractsConfig();
    const address = getRequiredAddress(contracts, "FACTORY");
    return new ethers.Contract(address, ABI_FACTORY, provider);
};

const getProvider = () => provider;

module.exports = {
    getProvider,
    getContractsConfig,
    getExclusiveNftContract,
    getFactoryContract
};
