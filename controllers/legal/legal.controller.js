const {
    listDocuments,
    getDocumentByKey,
    acceptDocumentVersion,
    listDocumentVersions,
    createDocumentVersion,
    publishDocumentVersion,
    extractUserFromRequest
} = require("../../services/legal/legal.service");

const setNoStore = (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
};

const legalController = {
    getDocuments: async (req, res) => {
        try {
            setNoStore(res);
            const user = extractUserFromRequest(req);
            const payload = await listDocuments({ userId: user?.id || null });

            return res.status(200).json({
                ok: true,
                documents: payload.documents,
                hasPending: payload.hasPending,
                pendingDocuments: payload.pendingDocuments
            });
        } catch (error) {
            console.error("Error getDocuments legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno obteniendo documentos legales." });
        }
    },

    getDocumentByKey: async (req, res) => {
        try {
            setNoStore(res);
            const user = extractUserFromRequest(req);
            const document = await getDocumentByKey({
                key: req.params?.key,
                userId: user?.id || null
            });

            if (!document) {
                return res.status(404).json({ ok: false, msj: "Documento legal no encontrado." });
            }

            return res.status(200).json({ ok: true, document });
        } catch (error) {
            console.error("Error getDocumentByKey legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno obteniendo el documento legal." });
        }
    },

    acceptDocument: async (req, res) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ ok: false, msj: "Token no proporcionado" });
            }

            const result = await acceptDocumentVersion({
                userId,
                documentKey: req.body?.documentKey,
                versionId: req.body?.versionId,
                source: req.body?.source,
                req
            });

            if (!result.ok) {
                return res.status(result.status || 400).json({ ok: false, msj: result.msg });
            }

            return res.status(200).json({
                ok: true,
                msj: "Aceptacion legal registrada correctamente.",
                acceptance: result.acceptance
            });
        } catch (error) {
            console.error("Error acceptDocument legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno registrando aceptacion legal." });
        }
    },

    getDocumentVersions: async (req, res) => {
        try {
            const result = await listDocumentVersions({ key: req.params?.key });
            if (!result.ok) {
                return res.status(result.status || 400).json({ ok: false, msj: result.msg });
            }

            return res.status(200).json({
                ok: true,
                document: result.document,
                versions: result.versions
            });
        } catch (error) {
            console.error("Error getDocumentVersions legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno obteniendo versiones legales." });
        }
    },

    createDocumentVersion: async (req, res) => {
        try {
            const result = await createDocumentVersion({
                key: req.params?.key,
                title: req.body?.title,
                version: req.body?.version,
                effectiveAt: req.body?.effectiveAt,
                contentUrl: req.body?.contentUrl,
                contentHtml: req.body?.contentHtml,
                changeSummary: req.body?.changeSummary,
                publish: req.body?.publish,
                actor: {
                    id: req.user?.id,
                    email: req.user?.email
                }
            });

            if (!result.ok) {
                return res.status(result.status || 400).json({ ok: false, msj: result.msg });
            }

            return res.status(result.status || 201).json({
                ok: true,
                msj: "Version legal creada correctamente.",
                document: result.document,
                version: result.version
            });
        } catch (error) {
            console.error("Error createDocumentVersion legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno creando version legal." });
        }
    },

    publishDocumentVersion: async (req, res) => {
        try {
            const result = await publishDocumentVersion({
                key: req.params?.key,
                versionId: req.params?.versionId
            });

            if (!result.ok) {
                return res.status(result.status || 400).json({ ok: false, msj: result.msg });
            }

            return res.status(200).json({
                ok: true,
                msj: "Version legal publicada y activada correctamente.",
                document: result.document,
                version: result.version
            });
        } catch (error) {
            console.error("Error publishDocumentVersion legal:", error);
            return res.status(500).json({ ok: false, msj: "Error interno publicando version legal." });
        }
    }
};

module.exports = legalController;
