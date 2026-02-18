const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const LegalDocument = require("../../models/legal/legalDocument.model");
const LegalDocumentVersion = require("../../models/legal/legalDocumentVersion.model");
const LegalAcceptance = require("../../models/legal/legalAcceptance.model");

const LEGAL_KEY_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_REGEX = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

const DEFAULT_LEGAL_SEED = [
    {
        key: "terms",
        title: "Terminos y Condiciones",
        versions: [
            {
                version: "1.0.0",
                effectiveAt: "2026-01-10T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/terms/1.0.0/es-CO.html",
                contentHtml: "<h1>Terminos y Condiciones</h1><p>Version inicial de terminos de servicio para TrustPlay.</p>",
                changeSummary: "Version inicial de terminos.",
                isPublished: true
            },
            {
                version: "1.1.0",
                effectiveAt: "2026-02-12T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/terms/1.1.0/es-CO.html",
                contentHtml: "<h1>Terminos y Condiciones</h1><p>Actualizacion de clausulas de versionado legal, seguridad y auditoria.</p>",
                changeSummary: "Se actualizo clausula de versionado legal y auditoria.",
                isPublished: true
            }
        ]
    },
    {
        key: "privacy",
        title: "Politica de Privacidad",
        versions: [
            {
                version: "1.0.0",
                effectiveAt: "2026-01-10T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/privacy/1.0.0/es-CO.html",
                contentHtml: "<h1>Politica de Privacidad</h1><p>Version inicial para tratamiento de datos personales.</p>",
                changeSummary: "Version inicial de privacidad.",
                isPublished: true
            },
            {
                version: "1.1.0",
                effectiveAt: "2026-02-12T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/privacy/1.1.0/es-CO.html",
                contentHtml: "<h1>Politica de Privacidad</h1><p>Actualizacion de conservacion de evidencias y controles de auditoria.</p>",
                changeSummary: "Se actualizo detalle de conservacion de evidencias.",
                isPublished: true
            }
        ]
    },
    {
        key: "cookies",
        title: "Politica de Cookies",
        versions: [
            {
                version: "1.0.0",
                effectiveAt: "2026-01-10T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/cookies/1.0.0/es-CO.html",
                contentHtml: "<h1>Politica de Cookies</h1><p>Version inicial de cookies y tecnologias equivalentes.</p>",
                changeSummary: "Version inicial de cookies.",
                isPublished: true
            },
            {
                version: "1.1.0",
                effectiveAt: "2026-02-12T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/cookies/1.1.0/es-CO.html",
                contentHtml: "<h1>Politica de Cookies</h1><p>Actualizacion de controles de sesion, seguridad y cookies de terceros.</p>",
                changeSummary: "Se detallaron cookies de seguridad y terceros.",
                isPublished: true
            }
        ]
    },
    {
        key: "disclaimer",
        title: "Disclaimer",
        versions: [
            {
                version: "1.0.0",
                effectiveAt: "2026-01-10T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/disclaimer/1.0.0/es-CO.html",
                contentHtml: "<h1>Disclaimer</h1><p>Version inicial de advertencias y limites de responsabilidad.</p>",
                changeSummary: "Version inicial de disclaimer.",
                isPublished: true
            },
            {
                version: "1.1.0",
                effectiveAt: "2026-02-12T00:00:00.000Z",
                contentUrl: "https://cdn.trustplay.com/legal/disclaimer/1.1.0/es-CO.html",
                contentHtml: "<h1>Disclaimer</h1><p>Actualizacion sobre riesgos de blockchain y contenido de terceros.</p>",
                changeSummary: "Se amplian advertencias de riesgos y terceros.",
                isPublished: true
            }
        ]
    }
];

const normalizeDocumentKey = (value) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized || !LEGAL_KEY_REGEX.test(normalized)) return "";
    return normalized;
};

const normalizeVersionTag = (value) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || !VERSION_REGEX.test(normalized)) return "";
    return normalized;
};

const normalizeTitle = (value, fallback = "") => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || fallback;
};

const normalizeOptionalString = (value, fallback = "") => (
    typeof value === "string" ? value.trim() : fallback
);

const toSafeDate = (value, fallback = new Date()) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return new Date(fallback);
    return parsed;
};

const getClientIp = (req) => {
    const forwarded = req?.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim().slice(0, 120);
    }
    return String(req?.ip || "").slice(0, 120);
};

const getUserAgent = (req) => {
    const userAgent = req?.headers?.["user-agent"];
    return typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
};

const toObjectId = (value) => {
    if (!value) return null;
    const asString = String(value);
    if (!mongoose.Types.ObjectId.isValid(asString)) return null;
    return new mongoose.Types.ObjectId(asString);
};

const buildVersionSha = ({ key, version, contentUrl, contentHtml }) => {
    const canonical = JSON.stringify({
        key: normalizeDocumentKey(key),
        version: normalizeVersionTag(version),
        contentUrl: normalizeOptionalString(contentUrl),
        contentHtml: normalizeOptionalString(contentHtml)
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
};

const toVersionSummary = (versionDoc, currentVersionId = null) => {
    if (!versionDoc) return null;
    const versionId = String(versionDoc._id);

    return {
        id: versionId,
        version: versionDoc.version,
        locale: versionDoc.locale,
        publishedAt: versionDoc.publishedAt,
        effectiveAt: versionDoc.effectiveAt,
        contentUrl: versionDoc.contentUrl,
        changeSummary: versionDoc.changeSummary,
        sha256: versionDoc.sha256,
        isPublished: versionDoc.isPublished === true,
        isCurrent: currentVersionId ? versionId === String(currentVersionId) : false,
        createdAt: versionDoc.createdAt,
        updatedAt: versionDoc.updatedAt
    };
};

const toDocumentSummary = ({ document, currentVersion, acceptance }) => ({
    key: document.key,
    title: document.title,
    status: document.status,
    currentVersion: toVersionSummary(currentVersion, document.currentVersionId),
    acceptedCurrentVersion: Boolean(acceptance),
    acceptedAt: acceptance?.acceptedAt || null
});

const toDocumentDetail = ({ document, currentVersion, acceptance }) => ({
    ...toDocumentSummary({ document, currentVersion, acceptance }),
    currentVersion: {
        ...toVersionSummary(currentVersion, document.currentVersionId),
        contentHtml: currentVersion?.contentHtml || ""
    }
});

const toPendingDescriptors = (documents = []) => (
    documents
        .map((item) => ({
            key: item.key,
            title: item.title,
            versionId: item.currentVersion?.id || "",
            version: item.currentVersion?.version || "",
            sha256: item.currentVersion?.sha256 || "",
            effectiveAt: item.currentVersion?.effectiveAt || null,
            changeSummary: item.currentVersion?.changeSummary || ""
        }))
);

const findPublishedCurrentDocuments = async () => {
    const documents = await LegalDocument.find({ status: "active" })
        .sort({ key: 1 })
        .populate({
            path: "currentVersionId",
            model: "LegalDocumentVersion"
        })
        .lean();

    return documents
        .filter((item) => item?.currentVersionId && item.currentVersionId.isPublished === true)
        .map((item) => ({
            document: item,
            currentVersion: item.currentVersionId
        }));
};

const getAcceptanceMapForUser = async (userId, versionIds) => {
    if (!userId || !Array.isArray(versionIds) || versionIds.length === 0) {
        return new Map();
    }

    const acceptances = await LegalAcceptance.find({
        userId,
        versionId: { $in: versionIds }
    }).lean();

    return new Map(acceptances.map((item) => [String(item.versionId), item]));
};

const listDocuments = async ({ userId } = {}) => {
    const published = await findPublishedCurrentDocuments();
    const versionIds = published.map((item) => item.currentVersion?._id).filter(Boolean);
    const acceptanceMap = await getAcceptanceMapForUser(userId, versionIds);

    const documents = published.map(({ document, currentVersion }) => {
        const acceptance = acceptanceMap.get(String(currentVersion._id));
        return toDocumentSummary({ document, currentVersion, acceptance });
    });

    const shouldEvaluatePending = Boolean(userId);
    const pending = shouldEvaluatePending
        ? toPendingDescriptors(
            documents.filter((item) => item.acceptedCurrentVersion === false)
        )
        : [];

    return {
        documents,
        hasPending: shouldEvaluatePending && pending.length > 0,
        pendingDocuments: pending
    };
};

const getDocumentByKey = async ({ key, userId } = {}) => {
    const normalizedKey = normalizeDocumentKey(key);
    if (!normalizedKey) return null;

    const document = await LegalDocument.findOne({ key: normalizedKey, status: "active" })
        .populate({
            path: "currentVersionId",
            model: "LegalDocumentVersion"
        })
        .lean();

    if (!document || !document.currentVersionId || document.currentVersionId.isPublished !== true) {
        return null;
    }

    let acceptance = null;
    if (userId) {
        acceptance = await LegalAcceptance.findOne({
            userId,
            versionId: document.currentVersionId._id
        }).lean();
    }

    return toDocumentDetail({
        document,
        currentVersion: document.currentVersionId,
        acceptance
    });
};

const acceptDocumentVersion = async ({ userId, documentKey, versionId, source, req }) => {
    const normalizedKey = normalizeDocumentKey(documentKey);
    if (!normalizedKey) {
        return { ok: false, status: 400, msg: "documentKey invalido." };
    }

    const versionObjectId = toObjectId(versionId);
    if (!versionObjectId) {
        return { ok: false, status: 400, msg: "versionId invalido." };
    }

    const document = await LegalDocument.findOne({ key: normalizedKey, status: "active" }).lean();
    if (!document) {
        return { ok: false, status: 404, msg: "Documento legal no encontrado." };
    }

    const versionDoc = await LegalDocumentVersion.findOne({
        _id: versionObjectId,
        documentId: document._id,
        isPublished: true
    }).lean();

    if (!versionDoc) {
        return { ok: false, status: 400, msg: "La version legal indicada no existe o no esta publicada." };
    }

    const acceptedAt = new Date();
    const payload = {
        userId,
        documentId: document._id,
        documentKey: normalizedKey,
        versionId: versionDoc._id,
        version: versionDoc.version,
        sha256: versionDoc.sha256,
        acceptedAt,
        ip: getClientIp(req),
        userAgent: getUserAgent(req),
        source: normalizeOptionalString(source, "legal_center") || "legal_center"
    };

    const acceptance = await LegalAcceptance.findOneAndUpdate(
        {
            userId,
            documentKey: normalizedKey,
            versionId: versionDoc._id
        },
        payload,
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    ).lean();

    return {
        ok: true,
        acceptance: {
            documentKey: acceptance.documentKey,
            versionId: String(acceptance.versionId),
            version: acceptance.version,
            sha256: acceptance.sha256,
            acceptedAt: acceptance.acceptedAt
        }
    };
};

const resolvePendingDocumentsForUser = async (userId) => {
    const { pendingDocuments } = await listDocuments({ userId });
    return pendingDocuments;
};

const normalizeLegacyAcceptancePayload = (payload) => payload?.accepted === true;

const ensureCurrentLegalAcceptanceForUser = async ({
    userId,
    legalAcceptancePayload,
    req,
    source
}) => {
    const pendingDocuments = await resolvePendingDocumentsForUser(userId);

    if (pendingDocuments.length === 0) {
        return {
            ok: true,
            acceptedNow: false,
            pendingDocuments: []
        };
    }

    if (!normalizeLegacyAcceptancePayload(legalAcceptancePayload)) {
        return {
            ok: false,
            acceptedNow: false,
            pendingDocuments,
            msg: "Debes aceptar los documentos legales vigentes para continuar."
        };
    }

    const acceptResults = await Promise.all(pendingDocuments.map((item) => (
        acceptDocumentVersion({
            userId,
            documentKey: item.key,
            versionId: item.versionId,
            source,
            req
        })
    )));

    const failedResult = acceptResults.find((item) => item.ok !== true);
    if (failedResult) {
        return {
            ok: false,
            acceptedNow: false,
            pendingDocuments,
            msg: failedResult.msg || "No se pudo registrar la aceptación legal vigente."
        };
    }

    return {
        ok: true,
        acceptedNow: true,
        pendingDocuments: []
    };
};

const ensureNewUserLegalAcceptance = async ({ legalAcceptancePayload }) => {
    const published = await findPublishedCurrentDocuments();
    const requiredDocuments = published.map(({ document, currentVersion }) => (
        toDocumentSummary({ document, currentVersion, acceptance: null })
    ));
    const pendingDocuments = toPendingDescriptors(requiredDocuments);

    if (pendingDocuments.length === 0) {
        return {
            ok: true,
            pendingDocuments: []
        };
    }

    if (!normalizeLegacyAcceptancePayload(legalAcceptancePayload)) {
        return {
            ok: false,
            msg: "Debes aceptar los documentos legales vigentes para continuar.",
            pendingDocuments
        };
    }

    return {
        ok: true,
        pendingDocuments
    };
};

const registerCurrentLegalAcceptanceForNewUser = async ({ userId, req, source }) => {
    const pendingDocuments = await resolvePendingDocumentsForUser(userId);
    if (pendingDocuments.length === 0) return;

    const acceptResults = await Promise.all(pendingDocuments.map((item) => (
        acceptDocumentVersion({
            userId,
            documentKey: item.key,
            versionId: item.versionId,
            source,
            req
        })
    )));

    const failedResult = acceptResults.find((item) => item.ok !== true);
    if (failedResult) {
        throw new Error(failedResult.msg || "No se pudo registrar aceptación legal inicial.");
    }
};

const listDocumentVersions = async ({ key }) => {
    const normalizedKey = normalizeDocumentKey(key);
    if (!normalizedKey) {
        return { ok: false, status: 400, msg: "key invalido." };
    }

    const document = await LegalDocument.findOne({ key: normalizedKey }).lean();
    if (!document) {
        return { ok: false, status: 404, msg: "Documento legal no encontrado." };
    }

    const versions = await LegalDocumentVersion.find({ documentId: document._id })
        .sort({ createdAt: -1, effectiveAt: -1 })
        .lean();

    return {
        ok: true,
        document: {
            key: document.key,
            title: document.title,
            status: document.status,
            currentVersionId: document.currentVersionId ? String(document.currentVersionId) : null
        },
        versions: versions.map((item) => toVersionSummary(item, document.currentVersionId))
    };
};

const createDocumentVersion = async ({
    key,
    title,
    version,
    effectiveAt,
    contentUrl,
    contentHtml,
    changeSummary,
    publish,
    actor
}) => {
    const normalizedKey = normalizeDocumentKey(key);
    const normalizedVersion = normalizeVersionTag(version);
    if (!normalizedKey) return { ok: false, status: 400, msg: "key invalido." };
    if (!normalizedVersion) return { ok: false, status: 400, msg: "version invalida." };

    const safeTitle = normalizeTitle(title, normalizedKey);
    const safeContentUrl = normalizeOptionalString(contentUrl);
    const safeContentHtml = typeof contentHtml === "string" ? contentHtml.trim() : "";

    if (!safeContentUrl && !safeContentHtml) {
        return {
            ok: false,
            status: 400,
            msg: "Debes enviar contentUrl o contentHtml para versionar el documento."
        };
    }

    const safeEffectiveAt = toSafeDate(effectiveAt, new Date());
    const safeChangeSummary = normalizeOptionalString(changeSummary).slice(0, 500);

    const sha256 = buildVersionSha({
        key: normalizedKey,
        version: normalizedVersion,
        contentUrl: safeContentUrl,
        contentHtml: safeContentHtml
    });

    let document = await LegalDocument.findOne({ key: normalizedKey });
    if (!document) {
        document = await LegalDocument.create({
            key: normalizedKey,
            title: safeTitle,
            status: "active"
        });
    } else if (safeTitle && safeTitle !== document.title) {
        document.title = safeTitle;
        await document.save();
    }

    const versionExists = await LegalDocumentVersion.findOne({
        documentId: document._id,
        version: normalizedVersion
    }).lean();

    if (versionExists) {
        return {
            ok: false,
            status: 409,
            msg: "La version ya existe para este documento."
        };
    }

    const publishNow = publish === true;
    const now = new Date();

    const createdVersion = await LegalDocumentVersion.create({
        documentId: document._id,
        version: normalizedVersion,
        locale: "es-CO",
        effectiveAt: safeEffectiveAt,
        contentUrl: safeContentUrl,
        contentHtml: safeContentHtml,
        sha256,
        changeSummary: safeChangeSummary,
        isPublished: publishNow,
        publishedAt: publishNow ? now : null,
        createdBy: {
            userId: toObjectId(actor?.id),
            email: normalizeOptionalString(actor?.email)
        }
    });

    if (publishNow) {
        document.currentVersionId = createdVersion._id;
        document.status = "active";
        await document.save();
    }

    return {
        ok: true,
        status: 201,
        document: {
            key: document.key,
            title: document.title,
            status: document.status,
            currentVersionId: document.currentVersionId ? String(document.currentVersionId) : null
        },
        version: toVersionSummary(createdVersion.toObject(), document.currentVersionId)
    };
};

const publishDocumentVersion = async ({ key, versionId }) => {
    const normalizedKey = normalizeDocumentKey(key);
    if (!normalizedKey) return { ok: false, status: 400, msg: "key invalido." };

    const versionObjectId = toObjectId(versionId);
    if (!versionObjectId) return { ok: false, status: 400, msg: "versionId invalido." };

    const document = await LegalDocument.findOne({ key: normalizedKey });
    if (!document) {
        return { ok: false, status: 404, msg: "Documento legal no encontrado." };
    }

    const versionDoc = await LegalDocumentVersion.findOne({
        _id: versionObjectId,
        documentId: document._id
    });

    if (!versionDoc) {
        return { ok: false, status: 404, msg: "Version legal no encontrada." };
    }

    versionDoc.isPublished = true;
    if (!versionDoc.publishedAt) {
        versionDoc.publishedAt = new Date();
    }
    await versionDoc.save();

    document.currentVersionId = versionDoc._id;
    document.status = "active";
    await document.save();

    return {
        ok: true,
        document: {
            key: document.key,
            title: document.title,
            status: document.status,
            currentVersionId: String(document.currentVersionId)
        },
        version: toVersionSummary(versionDoc.toObject(), document.currentVersionId)
    };
};

const extractUserFromRequest = (req) => {
    if (req?.user && req.user.id) {
        return {
            id: req.user.id,
            email: req.user.email || ""
        };
    }

    let token = "";
    if (req?.cookies?.token) {
        token = String(req.cookies.token);
    } else if (typeof req?.headers?.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
        token = req.headers.authorization.split(" ")[1] || "";
    }

    if (!token) return null;

    try {
        const decoded = jwt.verify(token, process.env.SECRET_JWT_KEY);
        if (!decoded?.id) return null;
        return {
            id: decoded.id,
            email: decoded.email || ""
        };
    } catch {
        return null;
    }
};

const seedLegalDocuments = async ({ force = false } = {}) => {
    for (const docSeed of DEFAULT_LEGAL_SEED) {
        const docKey = normalizeDocumentKey(docSeed.key);
        if (!docKey) continue;

        let document = await LegalDocument.findOne({ key: docKey });
        if (!document) {
            document = await LegalDocument.create({
                key: docKey,
                title: normalizeTitle(docSeed.title, docKey),
                status: "active"
            });
        }

        let latestPublishedVersion = null;

        for (const versionSeed of docSeed.versions || []) {
            const normalizedVersion = normalizeVersionTag(versionSeed.version);
            if (!normalizedVersion) continue;

            const existing = await LegalDocumentVersion.findOne({
                documentId: document._id,
                version: normalizedVersion
            });

            const payload = {
                documentId: document._id,
                version: normalizedVersion,
                locale: "es-CO",
                effectiveAt: toSafeDate(versionSeed.effectiveAt, new Date()),
                contentUrl: normalizeOptionalString(versionSeed.contentUrl),
                contentHtml: normalizeOptionalString(versionSeed.contentHtml),
                changeSummary: normalizeOptionalString(versionSeed.changeSummary),
                isPublished: versionSeed.isPublished === true,
                publishedAt: versionSeed.isPublished === true
                    ? toSafeDate(versionSeed.effectiveAt, new Date())
                    : null,
                sha256: buildVersionSha({
                    key: docKey,
                    version: normalizedVersion,
                    contentUrl: versionSeed.contentUrl,
                    contentHtml: versionSeed.contentHtml
                }),
                createdBy: {
                    email: "system@trustplay.local"
                }
            };

            let versionDoc = existing;
            if (!versionDoc) {
                versionDoc = await LegalDocumentVersion.create(payload);
            } else if (force) {
                Object.assign(versionDoc, payload);
                await versionDoc.save();
            }

            if (versionDoc.isPublished === true) {
                if (!latestPublishedVersion || versionDoc.effectiveAt.getTime() >= latestPublishedVersion.effectiveAt.getTime()) {
                    latestPublishedVersion = versionDoc;
                }
            }
        }

        if (latestPublishedVersion) {
            document.currentVersionId = latestPublishedVersion._id;
            document.status = "active";
            await document.save();
        }
    }
};

module.exports = {
    normalizeDocumentKey,
    normalizeVersionTag,
    listDocuments,
    getDocumentByKey,
    acceptDocumentVersion,
    ensureCurrentLegalAcceptanceForUser,
    ensureNewUserLegalAcceptance,
    registerCurrentLegalAcceptanceForNewUser,
    listDocumentVersions,
    createDocumentVersion,
    publishDocumentVersion,
    extractUserFromRequest,
    seedLegalDocuments
};
