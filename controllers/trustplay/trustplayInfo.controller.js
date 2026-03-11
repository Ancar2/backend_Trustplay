const TrustplayInfo = require("../../models/trustplay/trustplayInfo.model");
const { listDocuments } = require("../../services/legal/legal.service");

const DEFAULT_SOCIAL_LINKS = [
    { label: "TWITTER / X", url: "#", order: 1, active: true },
    { label: "FACEBOOK", url: "#", order: 2, active: true },
    { label: "INSTAGRAM", url: "#", order: 3, active: true },
    { label: "DISCORD", url: "#", order: 4, active: true },
    { label: "TELEGRAM", url: "#", order: 5, active: true },
    { label: "LINKEDIN", url: "#", order: 6, active: true },
];

const DEFAULT_SHARE_IMAGE = `${String(process.env.FRONTEND_URL || "https://trustplay.app").replace(/\/$/, "")}/assets/brand/logo-y-letra.png`;

const DEFAULT_SHARE_TITLE = "TrustPlay | Meeting Room";
const DEFAULT_SHARE_DESCRIPTION = "Accede a la sala oficial configurada por TrustPlay.";
const DEFAULT_USER_GUIDE_FILENAME = "guia-usuario-trustplay.pdf";
const MAX_USER_GUIDE_BYTES = Number(process.env.USER_GUIDE_MAX_BYTES || 5 * 1024 * 1024);

const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeUrl = (value, fallback = "#") => {
    const raw = String(value || "").trim();
    if (!raw) return fallback;

    try {
        const parsed = new URL(raw);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return parsed.toString();
        }
    } catch (_) {
        // noop
    }

    return fallback;
};

const sanitizeFileName = (value, fallback = DEFAULT_USER_GUIDE_FILENAME) => {
    const cleanValue = String(value || "")
        .replace(/[^\w.\- ]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const normalized = cleanValue || fallback;
    return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`;
};

const normalizePdfBase64 = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
};

const decodePdfBase64 = (value) => {
    const normalized = normalizePdfBase64(value);
    if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
        return null;
    }

    try {
        const buffer = Buffer.from(normalized, "base64");
        if (!buffer.length) return null;
        if (buffer.slice(0, 4).toString("utf8") !== "%PDF") return null;
        return buffer;
    } catch (_) {
        return null;
    }
};

const normalizeSlug = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeSocialLinks = (links) => {
    const source = Array.isArray(links) && links.length > 0 ? links : DEFAULT_SOCIAL_LINKS;

    return source
        .filter((link) => link && typeof link.label === "string" && link.label.trim().length > 0)
        .map((link, index) => ({
            label: link.label.trim(),
            url: safeUrl(link.url),
            content: "",
            active: typeof link.active === "boolean" ? link.active : true,
            order: Number.isFinite(Number(link.order)) ? Number(link.order) : index + 1,
        }))
        .sort((a, b) => a.order - b.order);
};

const normalizeShareRoom = (room, fallbackOrder = 0) => ({
    _id: room?._id || undefined,
    slug: normalizeSlug(room?.slug),
    title: String(room?.title || "").trim(),
    description: String(room?.description || "").trim(),
    imageUrl: safeUrl(room?.imageUrl, DEFAULT_SHARE_IMAGE),
    roomUrl: safeUrl(room?.roomUrl),
    platform: ["meet", "zoom", "other"].includes(String(room?.platform || "").trim().toLowerCase())
        ? String(room.platform).trim().toLowerCase()
        : "other",
    active: typeof room?.active === "boolean" ? room.active : true,
    order: Number.isFinite(Number(room?.order)) ? Number(room.order) : fallbackOrder,
});

const getRequestOrigin = (req) => {
    const forwardedHost = String(req.header("x-forwarded-host") || "").split(",")[0].trim();
    const host = forwardedHost || String(req.header("host") || "").trim();
    const forwardedProto = String(req.header("x-forwarded-proto") || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "https";
    return `${protocol}://${host}`;
};

const buildShareUrl = (req, slug) => `${getRequestOrigin(req)}/share/${encodeURIComponent(slug)}`;

const buildUserGuideDownloadUrl = (req) => `${getRequestOrigin(req)}/api/trustplay-info/user-guide/download`;

const buildUserGuidePayload = (userGuide, req = null) => {
    if (!userGuide || !userGuide.fileName || !userGuide.uploadedAt || !Number(userGuide.sizeBytes)) {
        return null;
    }

    return {
        fileName: userGuide.fileName,
        mimeType: userGuide.mimeType || "application/pdf",
        sizeBytes: Number(userGuide.sizeBytes),
        uploadedAt: userGuide.uploadedAt,
        uploadedByUsername: userGuide.uploadedByUsername || "",
        downloadUrl: req ? buildUserGuideDownloadUrl(req) : "/api/trustplay-info/user-guide/download",
    };
};

const isSocialCrawler = (req) => {
    const userAgent = String(req.header("user-agent") || "").toLowerCase();
    if (!userAgent) return false;

    const crawlerTokens = [
        "whatsapp",
        "facebookexternalhit",
        "meta-externalagent",
        "meta-externalfetcher",
        "telegrambot",
        "twitterbot",
        "linkedinbot",
        "slackbot",
        "discordbot",
        "skypeuripreview",
        "googlebot",
        "bingbot",
    ];

    return crawlerTokens.some((token) => userAgent.includes(token));
};

const buildLegalLinksFromDocuments = (documents = []) => (
    documents
        .filter((item) => item && typeof item.key === "string" && typeof item.title === "string")
        .map((item, index) => ({
            label: item.title,
            url: `/legal/${encodeURIComponent(item.key)}`,
            content: "",
            active: true,
            order: index + 1,
        }))
);

const ensureInfoDocument = async () => {
    let info = await TrustplayInfo.findOne();
    if (!info) {
        info = new TrustplayInfo({
            social: DEFAULT_SOCIAL_LINKS,
            shareRooms: [],
            userGuide: null,
        });
        await info.save();
    }
    return info;
};

const sanitizeShareRooms = (rooms = [], req = null) => rooms
    .map((room, index) => normalizeShareRoom(room, index + 1))
    .filter((room) => room.slug && room.title && room.description && room.roomUrl !== "#")
    .sort((a, b) => a.order - b.order)
    .map((room) => ({
        ...room,
        shareUrl: req ? buildShareUrl(req, room.slug) : undefined,
    }));

const buildInfoPayload = ({ info, legalDocuments, req = null }) => ({
    legal: buildLegalLinksFromDocuments(legalDocuments),
    social: normalizeSocialLinks(info?.social),
    userGuide: buildUserGuidePayload(info?.userGuide, req),
    createdAt: info?.createdAt || null,
    updatedAt: info?.updatedAt || null,
});

const trustplayInfoController = {
    getInfo: async (req, res) => {
        try {
            const info = await ensureInfoDocument();
            const legalResponse = await listDocuments();
            const legalDocuments = Array.isArray(legalResponse?.documents) ? legalResponse.documents : [];

            return res.status(200).json({
                ok: true,
                info: buildInfoPayload({ info, legalDocuments, req }),
            });
        } catch (error) {
            console.error("Error fetching trustplay info:", error);
            return res.status(500).json({
                ok: false,
                msg: "Error fetching trustplay info",
            });
        }
    },

    updateInfo: async (req, res) => {
        try {
            const hasLegacyLegalFields = (
                Object.prototype.hasOwnProperty.call(req.body || {}, "legal")
                || Object.prototype.hasOwnProperty.call(req.body || {}, "legalVersion")
                || Object.prototype.hasOwnProperty.call(req.body || {}, "legalVersions")
            );

            if (hasLegacyLegalFields) {
                return res.status(400).json({
                    ok: false,
                    msg: "La informacion legal ya no se actualiza por trustplay-info. Usa los endpoints /api/legal/*.",
                });
            }

            const info = await ensureInfoDocument();
            if (Object.prototype.hasOwnProperty.call(req.body || {}, "social")) {
                info.social = normalizeSocialLinks(req.body?.social);
                await info.save();
            }

            const legalResponse = await listDocuments();
            const legalDocuments = Array.isArray(legalResponse?.documents) ? legalResponse.documents : [];

            return res.status(200).json({
                ok: true,
                msg: "TrustPlay info updated successfully",
                info: buildInfoPayload({ info, legalDocuments, req }),
            });
        } catch (error) {
            console.error("Error updating trustplay info:", error);
            return res.status(500).json({
                ok: false,
                msg: "Error updating trustplay info",
            });
        }
    },

    uploadUserGuide: async (req, res) => {
        try {
            const fileName = sanitizeFileName(req.body?.fileName);
            const buffer = decodePdfBase64(req.body?.fileBase64);

            if (!buffer) {
                return res.status(400).json({
                    ok: false,
                    msg: "El archivo enviado no es un PDF valido.",
                });
            }

            if (buffer.length > MAX_USER_GUIDE_BYTES) {
                return res.status(413).json({
                    ok: false,
                    msg: `El PDF supera el tamaño máximo permitido (${Math.round(MAX_USER_GUIDE_BYTES / 1024 / 1024)} MB).`,
                });
            }

            const info = await ensureInfoDocument();
            info.userGuide = {
                fileName,
                mimeType: "application/pdf",
                sizeBytes: buffer.length,
                uploadedAt: new Date(),
                uploadedById: String(req.user?.id || ""),
                uploadedByUsername: String(req.user?.username || ""),
                data: buffer,
            };
            await info.save();

            return res.status(200).json({
                ok: true,
                msg: "Guia de usuario actualizada correctamente.",
                userGuide: buildUserGuidePayload(info.userGuide, req),
            });
        } catch (error) {
            console.error("Error uploading user guide:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo guardar la guia de usuario.",
            });
        }
    },

    deleteUserGuide: async (req, res) => {
        try {
            const info = await ensureInfoDocument();
            info.userGuide = null;
            await info.save();

            return res.status(200).json({
                ok: true,
                msg: "Guia de usuario eliminada correctamente.",
            });
        } catch (error) {
            console.error("Error deleting user guide:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo eliminar la guia de usuario.",
            });
        }
    },

    downloadUserGuide: async (req, res) => {
        try {
            const info = await TrustplayInfo.findOne().select("+userGuide.data");
            const userGuide = info?.userGuide;
            const guideBuffer = userGuide?.data;

            if (!guideBuffer || !Buffer.isBuffer(guideBuffer) || !guideBuffer.length) {
                return res.status(404).json({
                    ok: false,
                    msg: "No hay una guia de usuario disponible para descargar.",
                });
            }

            const downloadName = sanitizeFileName(userGuide?.fileName, DEFAULT_USER_GUIDE_FILENAME);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Length", String(guideBuffer.length));
            res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            return res.status(200).send(guideBuffer);
        } catch (error) {
            console.error("Error downloading user guide:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo descargar la guia de usuario.",
            });
        }
    },

    listShareRooms: async (req, res) => {
        try {
            const info = await ensureInfoDocument();
            const items = sanitizeShareRooms(info.shareRooms || [], req).map((item) => ({
                _id: item._id,
                slug: item.slug,
                title: item.title,
                description: item.description,
                imageUrl: item.imageUrl,
                roomUrl: item.roomUrl,
                platform: item.platform,
                active: item.active,
                order: item.order,
                shareUrl: item.shareUrl,
            }));

            return res.status(200).json({
                ok: true,
                items,
            });
        } catch (error) {
            console.error("Error listing share rooms:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo consultar la configuracion de compartidos.",
            });
        }
    },

    createShareRoom: async (req, res) => {
        try {
            const info = await ensureInfoDocument();
            const nextRoom = normalizeShareRoom(req.body || {}, (info.shareRooms?.length || 0) + 1);

            if (!nextRoom.slug || !nextRoom.title || !nextRoom.description || nextRoom.roomUrl === "#") {
                return res.status(400).json({
                    ok: false,
                    msg: "Debes enviar slug, titulo, descripcion y URL de sala validos.",
                });
            }

            const slugExists = (info.shareRooms || []).some((room) => normalizeSlug(room.slug) === nextRoom.slug);
            if (slugExists) {
                return res.status(409).json({
                    ok: false,
                    msg: "Ya existe una configuracion con ese slug.",
                });
            }

            info.shareRooms.push(nextRoom);
            await info.save();

            const created = sanitizeShareRooms(info.shareRooms, req)
                .find((room) => room.slug === nextRoom.slug);

            return res.status(201).json({
                ok: true,
                msg: "Configuracion creada correctamente.",
                item: created,
            });
        } catch (error) {
            console.error("Error creating share room:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo crear la configuracion de compartido.",
            });
        }
    },

    updateShareRoom: async (req, res) => {
        try {
            const { id } = req.params;
            const info = await ensureInfoDocument();
            const targetRoom = info.shareRooms.id(id);

            if (!targetRoom) {
                return res.status(404).json({
                    ok: false,
                    msg: "Configuracion no encontrada.",
                });
            }

            const nextRoom = normalizeShareRoom({ ...targetRoom.toObject(), ...(req.body || {}) }, targetRoom.order || 0);
            if (!nextRoom.slug || !nextRoom.title || !nextRoom.description || nextRoom.roomUrl === "#") {
                return res.status(400).json({
                    ok: false,
                    msg: "Debes enviar slug, titulo, descripcion y URL de sala validos.",
                });
            }

            const slugExists = (info.shareRooms || []).some((room) => (
                String(room._id) !== String(id) && normalizeSlug(room.slug) === nextRoom.slug
            ));
            if (slugExists) {
                return res.status(409).json({
                    ok: false,
                    msg: "Ya existe otra configuracion con ese slug.",
                });
            }

            targetRoom.slug = nextRoom.slug;
            targetRoom.title = nextRoom.title;
            targetRoom.description = nextRoom.description;
            targetRoom.imageUrl = nextRoom.imageUrl;
            targetRoom.roomUrl = nextRoom.roomUrl;
            targetRoom.platform = nextRoom.platform;
            targetRoom.active = nextRoom.active;
            targetRoom.order = nextRoom.order;

            await info.save();

            const updated = sanitizeShareRooms(info.shareRooms, req)
                .find((room) => String(room._id) === String(id));

            return res.status(200).json({
                ok: true,
                msg: "Configuracion actualizada correctamente.",
                item: updated,
            });
        } catch (error) {
            console.error("Error updating share room:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo actualizar la configuracion de compartido.",
            });
        }
    },

    deleteShareRoom: async (req, res) => {
        try {
            const { id } = req.params;
            const info = await ensureInfoDocument();
            const targetRoom = info.shareRooms.id(id);

            if (!targetRoom) {
                return res.status(404).json({
                    ok: false,
                    msg: "Configuracion no encontrada.",
                });
            }

            targetRoom.deleteOne();
            await info.save();

            return res.status(200).json({
                ok: true,
                msg: "Configuracion eliminada correctamente.",
            });
        } catch (error) {
            console.error("Error deleting share room:", error);
            return res.status(500).json({
                ok: false,
                msg: "No se pudo eliminar la configuracion de compartido.",
            });
        }
    },

    openShareRoomPage: async (req, res) => {
        try {
            const slug = normalizeSlug(req.params?.slug);
            if (!slug) {
                return res.status(404).send("Share not found");
            }

            const info = await ensureInfoDocument();
            const items = sanitizeShareRooms(info.shareRooms || [], req);
            const room = items.find((item) => item.slug === slug && item.active);

            if (!room) {
                return res.status(404).send("Share not found");
            }

            const roomUrl = safeUrl(room.roomUrl);
            if (roomUrl === "#") {
                return res.status(404).send("Share not found");
            }

            if (isSocialCrawler(req)) {
                const shareUrl = buildShareUrl(req, room.slug);
                const title = escapeHtml(String(room.title || DEFAULT_SHARE_TITLE).trim() || DEFAULT_SHARE_TITLE);
                const description = escapeHtml(
                    String(room.description || DEFAULT_SHARE_DESCRIPTION).trim() || DEFAULT_SHARE_DESCRIPTION
                );
                const imageUrl = escapeHtml(room.imageUrl || DEFAULT_SHARE_IMAGE);

                const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:site_name" content="TrustPlay" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
</head>
<body></body>
</html>`;

                res.setHeader("X-Robots-Tag", "noindex, nofollow");
                res.setHeader(
                    "Content-Security-Policy",
                    "default-src 'none'; img-src 'self' data: https: http:; style-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';"
                );
                res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
                res.setHeader("Pragma", "no-cache");
                res.setHeader("Expires", "0");
                return res.status(200).type("html").send(html);
            }

            return res.redirect(302, roomUrl);
        } catch (error) {
            console.error("Error opening share room page:", error);
            return res.status(500).send("Internal Server Error");
        }
    },
};

module.exports = trustplayInfoController;
