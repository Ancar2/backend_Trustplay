const { ethers } = require("ethers");

const ERC20_BALANCE_ABI = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address owner) view returns (uint256)",
];

const LOTTERY_INFO_ABI = [
    "function infoLottery() view returns (tuple(address stableCoin, uint128 boxPrice, uint128 boxesSold, uint128 totalBoxes, uint128 winningNumber))",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const normalizeAddress = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
        const checksum = ethers.getAddress(trimmed);
        return checksum === ZERO_ADDRESS ? "" : checksum.toLowerCase();
    } catch {
        return "";
    }
};

const normalizeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBoolean = (value) => Boolean(value);

const roundAmount = (value, decimals = 6) => {
    const factor = 10 ** Math.max(0, decimals);
    return Math.round((normalizeNumber(value) + Number.EPSILON) * factor) / factor;
};

const calculateFundingRequirementPlan = ({
    boxQuantity,
    boxPrice,
    currentUsdtBalance = 0,
    currentPolBalance = 0,
    minPolBalance = 1,
    skipNativeGasRequirement = false,
}) => {
    const quantity = Math.max(0, Math.floor(normalizeNumber(boxQuantity)));
    const price = Math.max(0, normalizeNumber(boxPrice));
    const purchaseCost = roundAmount(quantity * price);
    const currentUsdt = Math.max(0, normalizeNumber(currentUsdtBalance));
    const currentPol = Math.max(0, normalizeNumber(currentPolBalance));
    const targetPol = normalizeBoolean(skipNativeGasRequirement)
        ? 0
        : Math.max(0, normalizeNumber(minPolBalance));

    const requiredUsdt = roundAmount(Math.max(0, purchaseCost - currentUsdt));
    const requiredPol = roundAmount(Math.max(0, targetPol - currentPol));

    return {
        boxQuantity: quantity,
        boxPrice: roundAmount(price),
        purchaseCost,
        currentUsdtBalance: roundAmount(currentUsdt),
        currentPolBalance: roundAmount(currentPol),
        minPolBalance: roundAmount(targetPol),
        requiredUsdt,
        requiredPol,
        readyToBuy: requiredUsdt <= 0 && requiredPol <= 0,
        needsUsdt: requiredUsdt > 0,
        needsPol: requiredPol > 0,
    };
};

const readTokenDecimals = async (provider, tokenAddress) => {
    const address = normalizeAddress(tokenAddress);
    if (!address) return 18;

    try {
        const contract = new ethers.Contract(address, ERC20_BALANCE_ABI, provider);
        const decimals = await contract.decimals();
        const parsed = Number(decimals);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : 18;
    } catch {
        return 18;
    }
};

const readTokenBalance = async (provider, tokenAddress, walletAddress) => {
    const address = normalizeAddress(tokenAddress);
    const wallet = normalizeAddress(walletAddress);
    if (!address || !wallet) {
        return { balance: 0, decimals: 18 };
    }

    const decimals = await readTokenDecimals(provider, address);
    try {
        const contract = new ethers.Contract(address, ERC20_BALANCE_ABI, provider);
        const rawBalance = await contract.balanceOf(wallet);
        const balance = Number(ethers.formatUnits(rawBalance, decimals));
        return {
            balance: Number.isFinite(balance) ? roundAmount(balance, decimals) : 0,
            decimals,
        };
    } catch {
        return { balance: 0, decimals };
    }
};

const readNativeBalance = async (provider, walletAddress) => {
    const wallet = normalizeAddress(walletAddress);
    if (!wallet) {
        return 0;
    }

    try {
        const rawBalance = await provider.getBalance(wallet);
        const balance = Number(ethers.formatEther(rawBalance));
        return Number.isFinite(balance) ? roundAmount(balance, 6) : 0;
    } catch {
        return 0;
    }
};

const readLotterySnapshot = async (provider, lotteryAddress) => {
    const address = normalizeAddress(lotteryAddress);
    if (!address) {
        throw new Error("INVALID_LOTTERY_ADDRESS");
    }

    const lotteryContract = new ethers.Contract(address, LOTTERY_INFO_ABI, provider);
    const info = await lotteryContract.infoLottery();
    const stableCoinAddress = normalizeAddress(info?.stableCoin || "");
    const decimals = stableCoinAddress ? await readTokenDecimals(provider, stableCoinAddress) : 18;
    const boxPrice = Number(ethers.formatUnits(info?.boxPrice ?? 0n, decimals));

    return {
        lotteryAddress: address,
        stableCoinAddress,
        boxPrice: Number.isFinite(boxPrice) ? roundAmount(boxPrice, decimals) : 0,
        stableCoinDecimals: decimals,
        boxesSold: Number(info?.boxesSold ?? 0),
        totalBoxes: Number(info?.totalBoxes ?? 0),
        winningNumber: Number(info?.winningNumber ?? 0),
    };
};

const readWalletBalanceSnapshot = async ({
    provider,
    walletAddress,
    stableCoinAddress,
    minPolBalance = 1,
    skipNativeGasRequirement = false,
}) => {
    const wallet = normalizeAddress(walletAddress);
    const stableCoin = normalizeAddress(stableCoinAddress);
    const currentPolBalance = await readNativeBalance(provider, wallet);
    const { balance: currentUsdtBalance, decimals: stableCoinDecimals } = await readTokenBalance(provider, stableCoin, wallet);
    const normalizedMinPolBalance = normalizeBoolean(skipNativeGasRequirement)
        ? 0
        : roundAmount(normalizeNumber(minPolBalance));
    const requiredPol = Math.max(0, roundAmount(normalizedMinPolBalance - currentPolBalance));

    return {
        walletAddress: wallet,
        stableCoinAddress: stableCoin,
        stableCoinDecimals,
        currentUsdtBalance,
        currentPolBalance,
        minPolBalance: normalizedMinPolBalance,
        requiredPol,
        skipNativeGasRequirement: normalizeBoolean(skipNativeGasRequirement),
    };
};

const buildFundingPlan = ({
    lotterySnapshot,
    walletSnapshot,
    boxQuantity,
}) => {
    const plan = calculateFundingRequirementPlan({
        boxQuantity,
        boxPrice: lotterySnapshot.boxPrice,
        currentUsdtBalance: walletSnapshot.currentUsdtBalance,
        currentPolBalance: walletSnapshot.currentPolBalance,
        minPolBalance: walletSnapshot.minPolBalance,
        skipNativeGasRequirement: walletSnapshot.skipNativeGasRequirement,
    });

    return {
        ...plan,
        stableCoinAddress: lotterySnapshot.stableCoinAddress,
        stableCoinDecimals: lotterySnapshot.stableCoinDecimals,
        walletAddress: walletSnapshot.walletAddress,
        lotteryAddress: lotterySnapshot.lotteryAddress,
        boxesSold: lotterySnapshot.boxesSold,
        totalBoxes: lotterySnapshot.totalBoxes,
        winningNumber: lotterySnapshot.winningNumber,
    };
};

const evaluatePurchaseReadiness = ({
    balanceSnapshot,
    balanceGateEnabled,
}) => {
    const balanceGateActive = Boolean(balanceGateEnabled);
    const hasEnoughUsdt = balanceSnapshot.currentUsdtBalance >= balanceSnapshot.requiredUsdt;
    const hasEnoughPol = normalizeBoolean(balanceSnapshot.skipNativeGasRequirement)
        ? true
        : balanceSnapshot.currentPolBalance >= balanceSnapshot.minPolBalance;
    const readyToBuy = balanceGateActive && hasEnoughUsdt && hasEnoughPol;

    return {
        balanceGateEnabled: balanceGateActive,
        hasEnoughUsdt,
        hasEnoughPol,
        readyToBuy,
        missingUsdt: roundAmount(Math.max(0, balanceSnapshot.requiredUsdt - balanceSnapshot.currentUsdtBalance)),
        missingPol: normalizeBoolean(balanceSnapshot.skipNativeGasRequirement)
            ? 0
            : roundAmount(Math.max(0, balanceSnapshot.minPolBalance - balanceSnapshot.currentPolBalance)),
    };
};

module.exports = {
    buildFundingPlan,
    calculateFundingRequirementPlan,
    evaluatePurchaseReadiness,
    normalizeAddress,
    normalizeNumber,
    readLotterySnapshot,
    readNativeBalance,
    readTokenBalance,
    readTokenDecimals,
    readWalletBalanceSnapshot,
    roundAmount,
};
