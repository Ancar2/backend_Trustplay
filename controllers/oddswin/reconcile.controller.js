const {
    runOddswinReconciliation,
    getOddswinReconcileStatus,
    requestOddswinReconcileStop
} = require("../../services/oddswin/reconcile.service");
const Lottery = require("../../models/oddswin/lottery.model");

const toOptionalInt = (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : undefined;
};

const toOptionalAddress = (value) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
};

exports.runReconcile = async (req, res) => {
    try {
        const options = {
            source: "manual",
            fromBlock: toOptionalInt(req.body.fromBlock),
            toBlock: toOptionalInt(req.body.toBlock),
            maxRange: toOptionalInt(req.body.maxRange),
            confirmations: toOptionalInt(req.body.confirmations),
            yearStart: toOptionalInt(req.body.yearStart),
            yearEnd: toOptionalInt(req.body.yearEnd),
            lotteryAddress: toOptionalAddress(req.body.lotteryAddress)
        };

        const report = await runOddswinReconciliation(options);
        return res.status(200).json({
            ok: true,
            report
        });
    } catch (error) {
        if (error.message === "Ya existe una reconciliacion en curso") {
            return res.status(409).json({
                ok: false,
                msj: error.message
            });
        }

        console.error("Error runReconcile:", error);
        return res.status(500).json({
            ok: false,
            msj: "Error ejecutando reconciliacion"
        });
    }
};

exports.syncLotteries = async (req, res) => {
    try {
        const options = {
            source: "manual",
            onlyLotteries: true,
            yearStart: toOptionalInt(req.body.yearStart),
            yearEnd: toOptionalInt(req.body.yearEnd)
        };

        const report = await runOddswinReconciliation(options);
        return res.status(200).json({
            ok: true,
            report
        });
    } catch (error) {
        if (error.message === "Ya existe una reconciliacion en curso") {
            return res.status(409).json({
                ok: false,
                msj: error.message
            });
        }

        console.error("Error syncLotteries:", error);
        return res.status(500).json({
            ok: false,
            msj: "Error sincronizando loterias"
        });
    }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

exports.getReconcileLotteriesOptions = async (req, res) => {
    try {
        const rawLimit = Number(req.query.limit);
        const limit = Number.isInteger(rawLimit) && rawLimit > 0
            ? Math.min(rawLimit, 2000)
            : 500;
        const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const normalizedQuery = query.toLowerCase();

        const filter = {};
        if (query.length > 0) {
            const escaped = escapeRegex(query);
            const escapedLower = escapeRegex(normalizedQuery);
            filter.$or = [
                { address: { $regex: escapedLower } },
                { name: { $regex: escaped, $options: "i" } },
                { symbol: { $regex: escaped, $options: "i" } }
            ];
        }

        const lotteries = await Lottery.find(filter)
            .select("address name symbol year index status")
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const options = lotteries.map((lottery) => ({
            address: lottery.address,
            name: lottery.name || "",
            symbol: lottery.symbol || "",
            year: lottery.year || null,
            index: lottery.index || null,
            status: lottery.status || "",
            label: `${lottery.symbol || "LOT"} | ${lottery.year || "-"}-${lottery.index || "-"} | ${lottery.address}`
        }));

        return res.status(200).json({
            ok: true,
            lotteries: options
        });
    } catch (error) {
        console.error("Error getReconcileLotteriesOptions:", error);
        return res.status(500).json({
            ok: false,
            msj: "Error obteniendo loterias para reconciliacion"
        });
    }
};

exports.getReconcileStatus = async (req, res) => {
    try {
        const status = await getOddswinReconcileStatus();
        return res.status(200).json({
            ok: true,
            status
        });
    } catch (error) {
        console.error("Error getReconcileStatus:", error);
        return res.status(500).json({
            ok: false,
            msj: "Error obteniendo estado de reconciliacion"
        });
    }
};

exports.stopReconcile = async (req, res) => {
    try {
        const result = await requestOddswinReconcileStop();

        if (!result.accepted) {
            return res.status(409).json({
                ok: false,
                msj: "No hay una reconciliacion en ejecucion para detener"
            });
        }

        return res.status(202).json({
            ok: true,
            msj: "Solicitud de detencion enviada",
            status: result.status
        });
    } catch (error) {
        console.error("Error stopReconcile:", error);
        return res.status(500).json({
            ok: false,
            msj: "Error solicitando detencion de reconciliacion"
        });
    }
};
