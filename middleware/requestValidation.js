const isPlainObject = (value) => (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
);

const isNonEmptyString = (value) => (
    typeof value === "string"
    && value.trim().length > 0
);

const isFiniteNumberLike = (value) => {
    if (value === "" || value === null || value === undefined) return false;
    const parsed = Number(value);
    return Number.isFinite(parsed);
};

const isIntegerLike = (value) => (
    isFiniteNumberLike(value) && Number.isInteger(Number(value))
);

const isHexAddress = (value) => (
    typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim())
);

const validateRequest = (validator) => (req, res, next) => {
    const errors = validator(req);
    if (errors.length > 0) {
        return res.status(400).json({
            msj: "Solicitud inválida",
            errors
        });
    }

    return next();
};

const validateRegisterBody = (req) => {
    const errors = [];
    const { username, email, password, sponsor, photo, legalAcceptance } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(username)) errors.push("username es requerido.");
    if (!isNonEmptyString(email)) errors.push("email es requerido.");
    if (!isNonEmptyString(password)) errors.push("password es requerido.");
    if (typeof username === "string" && username.trim().length > 64) errors.push("username excede 64 caracteres.");
    if (typeof email === "string" && email.trim().length > 254) errors.push("email excede 254 caracteres.");
    if (typeof password === "string" && password.length > 256) errors.push("password excede 256 caracteres.");
    if (sponsor !== undefined && sponsor !== null && typeof sponsor !== "string") errors.push("sponsor debe ser string.");
    if (photo !== undefined && photo !== null && typeof photo !== "string") errors.push("photo debe ser string.");
    if (legalAcceptance !== undefined && !isPlainObject(legalAcceptance)) {
        errors.push("legalAcceptance debe ser un objeto.");
    }

    return errors;
};

const validateLoginBody = (req) => {
    const errors = [];
    const { email, password, legalAcceptance } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(email)) errors.push("email es requerido.");
    if (!isNonEmptyString(password)) errors.push("password es requerido.");
    if (legalAcceptance !== undefined && !isPlainObject(legalAcceptance)) {
        errors.push("legalAcceptance debe ser un objeto.");
    }

    return errors;
};

const validateSocialLoginBody = (req) => {
    const errors = [];
    const { provider, token, code, legalAcceptance } = req.body || {};
    const allowedProviders = ["google", "facebook", "instagram"];

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(provider)) {
        errors.push("provider es requerido.");
        return errors;
    }

    if (!allowedProviders.includes(provider)) {
        errors.push("provider no soportado.");
    }

    if (provider === "instagram") {
        if (!isNonEmptyString(code) && !isNonEmptyString(token)) {
            errors.push("instagram requiere code o token.");
        }
    } else if (!isNonEmptyString(token)) {
        errors.push("token es requerido para este provider.");
    }

    if (legalAcceptance !== undefined && !isPlainObject(legalAcceptance)) {
        errors.push("legalAcceptance debe ser un objeto.");
    }

    return errors;
};

const validateCompleteSocialLoginBody = (req) => {
    const errors = [];
    const { email, tempToken, legalAcceptance } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(email)) errors.push("email es requerido.");
    if (!isNonEmptyString(tempToken)) errors.push("tempToken es requerido.");
    if (legalAcceptance !== undefined && !isPlainObject(legalAcceptance)) {
        errors.push("legalAcceptance debe ser un objeto.");
    }

    return errors;
};

const validateForgotPasswordBody = (req) => {
    const errors = [];
    const { email } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(email)) errors.push("email es requerido.");

    return errors;
};

const validateResetPasswordBody = (req) => {
    const errors = [];
    const { password } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(password)) errors.push("password es requerido.");

    return errors;
};

const validateResendVerificationBody = (req) => {
    const errors = [];
    const { email } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(email)) errors.push("email es requerido.");

    return errors;
};

const validateAddWalletBody = (req) => {
    const errors = [];
    const { walletAddress } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(walletAddress)) errors.push("walletAddress es requerido.");

    return errors;
};

const validateCreateLotteryBody = (req) => {
    const errors = [];
    const {
        address,
        stableCoin,
        year,
        index,
        totalBoxes,
        boxPrice,
        percentageWinner,
        percentageSponsorWinner,
        percentageMostReferrals
    } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(address)) errors.push("address es requerido.");
    if (!isNonEmptyString(stableCoin)) errors.push("stableCoin es requerido.");

    if (year !== undefined && !isIntegerLike(year)) errors.push("year debe ser entero.");
    if (index !== undefined && !isIntegerLike(index)) errors.push("index debe ser entero.");
    if (totalBoxes !== undefined && !isIntegerLike(totalBoxes)) errors.push("totalBoxes debe ser entero.");
    if (boxPrice !== undefined && !isFiniteNumberLike(boxPrice)) errors.push("boxPrice debe ser numérico.");
    if (totalBoxes !== undefined && isIntegerLike(totalBoxes) && Number(totalBoxes) < 0) {
        errors.push("totalBoxes no puede ser negativo.");
    }
    if (boxPrice !== undefined && isFiniteNumberLike(boxPrice) && Number(boxPrice) < 0) {
        errors.push("boxPrice no puede ser negativo.");
    }
    if (percentageWinner !== undefined && !isFiniteNumberLike(percentageWinner)) {
        errors.push("percentageWinner debe ser numérico.");
    }
    if (percentageSponsorWinner !== undefined && !isFiniteNumberLike(percentageSponsorWinner)) {
        errors.push("percentageSponsorWinner debe ser numérico.");
    }
    if (percentageMostReferrals !== undefined && !isFiniteNumberLike(percentageMostReferrals)) {
        errors.push("percentageMostReferrals debe ser numérico.");
    }

    return errors;
};

const validateCloseLotteryBody = (req) => {
    const errors = [];
    const {
        winningNumber,
        winnerAddress,
        winnerSponsor,
        winnerTopBuyer,
        winnerMostReferrals,
        finalPool,
        txHash
    } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (winningNumber !== undefined && !isIntegerLike(winningNumber)) {
        errors.push("winningNumber debe ser entero.");
    }
    if (winningNumber !== undefined && isIntegerLike(winningNumber) && Number(winningNumber) < 0) {
        errors.push("winningNumber no puede ser negativo.");
    }

    [winnerAddress, winnerSponsor, winnerTopBuyer, winnerMostReferrals].forEach((item) => {
        if (item !== undefined && item !== null && typeof item !== "string") {
            errors.push("Las wallets de ganador deben ser string.");
        }
    });

    if (finalPool !== undefined && !isFiniteNumberLike(finalPool)) {
        errors.push("finalPool debe ser numérico.");
    }
    if (finalPool !== undefined && isFiniteNumberLike(finalPool) && Number(finalPool) < 0) {
        errors.push("finalPool no puede ser negativo.");
    }

    if (txHash !== undefined && txHash !== null) {
        if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
            errors.push("txHash debe ser un hash válido de transacción.");
        }
    }

    return errors;
};

const validateLotteryEventScheduleBody = (req) => {
    const errors = [];
    const { scheduledAt } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(scheduledAt)) {
        errors.push("scheduledAt es requerido.");
        return errors;
    }

    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime())) {
        errors.push("scheduledAt debe ser una fecha válida.");
    }

    return errors;
};

const validateLotteryResultVideoBody = (req) => {
    const errors = [];
    const { videoUrl, videoTitle } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(videoUrl)) {
        errors.push("videoUrl es requerido.");
        return errors;
    }

    if (videoTitle !== undefined && videoTitle !== null && typeof videoTitle !== "string") {
        errors.push("videoTitle debe ser string.");
    }

    if (typeof videoTitle === "string" && videoTitle.trim().length > 160) {
        errors.push("videoTitle excede 160 caracteres.");
    }

    return errors;
};

const validateRegisterBoxPurchaseBody = (req) => {
    const errors = [];
    const {
        lotteryAddress,
        boxId,
        owner,
        ticket1,
        ticket2,
        transactionHash,
        sponsor
    } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isNonEmptyString(lotteryAddress)) errors.push("lotteryAddress es requerido.");
    if (!isIntegerLike(boxId)) errors.push("boxId debe ser entero.");
    if (isIntegerLike(boxId) && Number(boxId) < 0) errors.push("boxId no puede ser negativo.");
    if (!isNonEmptyString(owner)) errors.push("owner es requerido.");
    if (!isNonEmptyString(transactionHash)) errors.push("transactionHash es requerido.");
    if (ticket1 !== undefined && !isIntegerLike(ticket1)) errors.push("ticket1 debe ser entero.");
    if (ticket2 !== undefined && !isIntegerLike(ticket2)) errors.push("ticket2 debe ser entero.");
    if (ticket1 !== undefined && isIntegerLike(ticket1) && Number(ticket1) < 0) {
        errors.push("ticket1 no puede ser negativo.");
    }
    if (ticket2 !== undefined && isIntegerLike(ticket2) && Number(ticket2) < 0) {
        errors.push("ticket2 no puede ser negativo.");
    }
    if (sponsor !== undefined && sponsor !== null && typeof sponsor !== "string") {
        errors.push("sponsor debe ser string.");
    }

    return errors;
};

const validateClaimRecordBody = (req) => {
    const errors = [];
    const { tokenId, owner, amount } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (!isIntegerLike(tokenId)) errors.push("tokenId debe ser entero.");
    if (isIntegerLike(tokenId) && Number(tokenId) <= 0) errors.push("tokenId debe ser mayor a 0.");
    if (!isNonEmptyString(owner)) errors.push("owner es requerido.");
    if (!isFiniteNumberLike(amount)) errors.push("amount debe ser numérico.");
    if (isFiniteNumberLike(amount) && Number(amount) < 0) errors.push("amount no puede ser negativo.");

    return errors;
};

const validateConfigUpdateBody = (req) => {
    const errors = [];
    const { sponsors, middleware, factory, exclusiveNFT, usdt, owner } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");

    [sponsors, middleware, factory, exclusiveNFT, usdt, owner].forEach((value) => {
        if (value !== undefined && value !== null && typeof value !== "string") {
            errors.push("Los campos de config deben ser string.");
        }
    });

    return errors;
};

const validateTrustplayUpdateBody = (req) => {
    const errors = [];
    const { legal, social, legalVersion } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");
    if (legal !== undefined && !Array.isArray(legal)) errors.push("legal debe ser un arreglo.");
    if (social !== undefined && !Array.isArray(social)) errors.push("social debe ser un arreglo.");
    if (legalVersion !== undefined && legalVersion !== null && typeof legalVersion !== "string") {
        errors.push("legalVersion debe ser string.");
    }

    return errors;
};

const validateReconcileBody = (req) => {
    const errors = [];
    const {
        fromBlock,
        toBlock,
        maxRange,
        confirmations,
        yearStart,
        yearEnd,
        lotteryAddress
    } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");

    if (fromBlock !== undefined && !isIntegerLike(fromBlock)) errors.push("fromBlock debe ser entero.");
    if (toBlock !== undefined && !isIntegerLike(toBlock)) errors.push("toBlock debe ser entero.");
    if (maxRange !== undefined && !isIntegerLike(maxRange)) errors.push("maxRange debe ser entero.");
    if (confirmations !== undefined && !isIntegerLike(confirmations)) errors.push("confirmations debe ser entero.");
    if (yearStart !== undefined && !isIntegerLike(yearStart)) errors.push("yearStart debe ser entero.");
    if (yearEnd !== undefined && !isIntegerLike(yearEnd)) errors.push("yearEnd debe ser entero.");
    if (lotteryAddress !== undefined && !isHexAddress(lotteryAddress)) {
        errors.push("lotteryAddress debe ser una direccion valida.");
    }

    if (fromBlock !== undefined && isIntegerLike(fromBlock) && Number(fromBlock) < 0) {
        errors.push("fromBlock no puede ser negativo.");
    }
    if (toBlock !== undefined && isIntegerLike(toBlock) && Number(toBlock) < 0) {
        errors.push("toBlock no puede ser negativo.");
    }
    if (maxRange !== undefined && isIntegerLike(maxRange) && Number(maxRange) <= 0) {
        errors.push("maxRange debe ser mayor a 0.");
    }
    if (confirmations !== undefined && isIntegerLike(confirmations) && Number(confirmations) < 0) {
        errors.push("confirmations no puede ser negativo.");
    }
    if (yearStart !== undefined && isIntegerLike(yearStart) && Number(yearStart) <= 0) {
        errors.push("yearStart debe ser mayor a 0.");
    }
    if (yearEnd !== undefined && isIntegerLike(yearEnd) && Number(yearEnd) <= 0) {
        errors.push("yearEnd debe ser mayor a 0.");
    }
    if (
        fromBlock !== undefined
        && toBlock !== undefined
        && isIntegerLike(fromBlock)
        && isIntegerLike(toBlock)
        && Number(fromBlock) > Number(toBlock)
    ) {
        errors.push("fromBlock no puede ser mayor que toBlock.");
    }
    if (
        yearStart !== undefined
        && yearEnd !== undefined
        && isIntegerLike(yearStart)
        && isIntegerLike(yearEnd)
        && Number(yearStart) > Number(yearEnd)
    ) {
        errors.push("yearStart no puede ser mayor que yearEnd.");
    }

    return errors;
};

const validateReconcileLotteriesBody = (req) => {
    const errors = [];
    const { yearStart, yearEnd } = req.body || {};

    if (!isPlainObject(req.body)) errors.push("El body debe ser un objeto JSON válido.");

    if (yearStart !== undefined && !isIntegerLike(yearStart)) errors.push("yearStart debe ser entero.");
    if (yearEnd !== undefined && !isIntegerLike(yearEnd)) errors.push("yearEnd debe ser entero.");

    if (yearStart !== undefined && isIntegerLike(yearStart) && Number(yearStart) <= 0) {
        errors.push("yearStart debe ser mayor a 0.");
    }
    if (yearEnd !== undefined && isIntegerLike(yearEnd) && Number(yearEnd) <= 0) {
        errors.push("yearEnd debe ser mayor a 0.");
    }

    if (
        yearStart !== undefined
        && yearEnd !== undefined
        && isIntegerLike(yearStart)
        && isIntegerLike(yearEnd)
        && Number(yearStart) > Number(yearEnd)
    ) {
        errors.push("yearStart no puede ser mayor que yearEnd.");
    }

    return errors;
};

module.exports = {
    validateRequest,
    validators: {
        registerBody: validateRegisterBody,
        loginBody: validateLoginBody,
        socialLoginBody: validateSocialLoginBody,
        completeSocialLoginBody: validateCompleteSocialLoginBody,
        forgotPasswordBody: validateForgotPasswordBody,
        resetPasswordBody: validateResetPasswordBody,
        resendVerificationBody: validateResendVerificationBody,
        addWalletBody: validateAddWalletBody,
        createLotteryBody: validateCreateLotteryBody,
        closeLotteryBody: validateCloseLotteryBody,
        lotteryEventScheduleBody: validateLotteryEventScheduleBody,
        lotteryResultVideoBody: validateLotteryResultVideoBody,
        registerBoxPurchaseBody: validateRegisterBoxPurchaseBody,
        claimRecordBody: validateClaimRecordBody,
        configUpdateBody: validateConfigUpdateBody,
        trustplayUpdateBody: validateTrustplayUpdateBody,
        reconcileBody: validateReconcileBody,
        reconcileLotteriesBody: validateReconcileLotteriesBody
    }
};
