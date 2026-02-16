const LegalAcceptanceLog = require("../../models/trustplay/legalAcceptanceLog.model");

const toPositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : fallback;
};

exports.getAcceptanceAudit = async (req, res) => {
    try {
        const page = toPositiveInt(req.query?.page, 1);
        const limit = Math.min(toPositiveInt(req.query?.limit, 20), 100);
        const skip = (page - 1) * limit;

        const query = {};
        const email = String(req.query?.email || "").trim().toLowerCase();
        const legalVersion = String(req.query?.legalVersion || "").trim();
        const source = String(req.query?.source || "").trim();
        const userId = String(req.query?.userId || "").trim();

        if (email) query.email = email;
        if (legalVersion) query.legalVersion = legalVersion;
        if (source) query.source = source;
        if (userId) query.userId = userId;

        const [logs, total] = await Promise.all([
            LegalAcceptanceLog.find(query)
                .sort({ acceptedAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            LegalAcceptanceLog.countDocuments(query)
        ]);

        return res.status(200).json({
            ok: true,
            logs,
            page,
            limit,
            total,
            totalPages: total > 0 ? Math.ceil(total / limit) : 1
        });
    } catch (error) {
        console.error("Error getAcceptanceAudit:", error);
        return res.status(500).json({ ok: false, msj: "Error interno consultando auditoría legal" });
    }
};

