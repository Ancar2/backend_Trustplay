const { ethers } = require("ethers");

// Configuración de la Red (Amoy)
// NOTA: Usamos un RPC público o el definido en .env
const RPC_URL = process.env.RPC_URL_AMOY || "https://rpc-amoy.polygon.technology/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Direcciones de Contratos (Amoy)
// Provistas por el usuario
const CONTRACTS = {
    FACTORY: "0xeC0c20136BfaB92f495Ae1A46f1094d90E2c4D62",
    EXCLUSIVE_NFT: "0xf9a6ACbC87667418085e4396E66F24D720B4cbc8", // Proxy
    LOTTERY_V2: "0x18f769D99e0ecd13fAd92E027035A5fa30c5C9B0" // TODO: Verificar si esta también cambia
};

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

// Instancias de Contratos
const getExclusiveNftContract = () => {
    return new ethers.Contract(CONTRACTS.EXCLUSIVE_NFT, ABI_EXCLUSIVE_NFT, provider);
};

const getFactoryContract = () => {
    return new ethers.Contract(CONTRACTS.FACTORY, ABI_FACTORY, provider);
};

const getProvider = () => provider;

module.exports = {
    getProvider,
    getExclusiveNftContract,
    getFactoryContract,
    CONTRACTS
};
