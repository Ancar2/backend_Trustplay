const TrustplayInfo = require('../../models/trustplay/trustplayInfo.model');
const { DEFAULT_LEGAL_VERSION, sanitizeLegalVersion } = require('../../utils/legalAcceptance');

const DEFAULT_LEGAL_UPDATED_AT = new Date('2026-02-12T00:00:00.000Z');

const LEGAL_DOCS = [
    {
        label: 'Términos de Servicio',
        slug: 'terminos-servicio',
        content: `Al utilizar TrustPlay y sus productos (incluyendo OddsWin), aceptas estos términos, la normativa aplicable y las reglas operativas publicadas en la plataforma.

OddsWin puede usar resultados oficiales de un evento de selección aleatoria administrado por una entidad pública regional como referencia externa para definir la metadata ganadora de un evento. Esa referencia no implica afiliación, representación ni patrocinio por parte de dicha entidad.

TrustPlay puede mostrar transmisiones o videos de terceros (por ejemplo, YouTube) únicamente con fines informativos y de referencia operacional del evento. TrustPlay no es propietario, productor ni patrocinador de dichos contenidos y no garantiza su disponibilidad continua, calidad, exactitud editorial o permanencia.

Los NFTs comercializados en el evento son activos coleccionables digitales. Su vigencia y utilidad están limitadas al evento correspondiente y pueden finalizar al cierre del evento o una vez definida la metadata ganadora.`,
        order: 1,
        active: true
    },
    {
        label: 'Política de Privacidad',
        slug: 'politica-privacidad',
        content: `TrustPlay trata datos necesarios para operar la plataforma: información de cuenta (email, username), sesiones técnicas y direcciones wallet vinculadas por el usuario.

Cuando se habilita autenticación social (Google, Facebook o Instagram), se procesan los datos autorizados por el usuario para acceso y continuidad de cuenta.

El tratamiento se limita a autenticación, seguridad, prevención de fraude, soporte y operación del servicio. TrustPlay no solicita claves privadas de wallets ni publica contraseñas en texto plano.`,
        order: 2,
        active: true
    },
    {
        label: 'Cookies',
        slug: 'cookies',
        content: `TrustPlay utiliza cookies y tecnologías equivalentes para mantener sesiones activas, reforzar seguridad y garantizar funcionamiento técnico.

Desactivar cookies esenciales puede afectar autenticación, persistencia de sesión y experiencia de uso.

Las integraciones de terceros pueden aplicar sus propias políticas de cookies. Esto incluye reproductores embebidos y servicios externos de video, que pueden establecer cookies propias según su política.

El usuario puede gestionar preferencias desde el navegador entendiendo el impacto funcional asociado.`,
        order: 3,
        active: true
    },
    {
        label: 'Disclaimer',
        slug: 'disclaimer',
        content: `TrustPlay y OddsWin no constituyen asesoría financiera, legal ni de inversión. La compra de NFTs coleccionables y el uso de productos blockchain implican riesgos técnicos y de mercado.

No se garantizan rendimientos económicos ni resultados específicos. El usuario es responsable de verificar direcciones, contratos y condiciones del evento antes de transaccionar.

La referencia a resultados oficiales de un evento de selección aleatoria administrado por una entidad pública regional se limita al criterio operativo de metadata ganadora y no implica vínculo institucional con dicha entidad.

Las transmisiones y videos de terceros se muestran en modalidad "tal cual" (as is). TrustPlay no asume responsabilidad por suspensión, bloqueo geográfico, eliminación, cambios de título/contenido, interrupciones o reclamaciones de propiedad intelectual del material audiovisual de terceros.`,
        order: 4,
        active: true
    }
];

const DEFAULT_SOCIAL_LINKS = [
    { label: 'TWITTER / X', url: '#', order: 1, active: true },
    { label: 'FACEBOOK', url: '#', order: 2, active: true },
    { label: 'INSTAGRAM', url: '#', order: 3, active: true },
    { label: 'DISCORD', url: '#', order: 4, active: true },
    { label: 'TELEGRAM', url: '#', order: 5, active: true },
    { label: 'LINKEDIN', url: '#', order: 6, active: true }
];

const LEGAL_VERSIONED_PATH_PATTERN = /^\/legal\/co\/LEGAL-TP-[A-Za-z0-9-]+\/[^/]+\.html$/i;

const buildLegalDocUrl = (legalVersion, slug) => `/legal/co/${legalVersion}/${slug}.html`;

const buildDefaultInfo = (legalVersion = DEFAULT_LEGAL_VERSION) => ({
    legalVersion,
    legalUpdatedAt: DEFAULT_LEGAL_UPDATED_AT,
    legal: LEGAL_DOCS.map((item) => ({
        ...item,
        url: buildLegalDocUrl(legalVersion, item.slug)
    })),
    social: DEFAULT_SOCIAL_LINKS.map((item) => ({ ...item }))
});

const DEFAULT_INFO = buildDefaultInfo();

const normalizeSelectionEventReference = (content = '') => (
    content.replace(
        /loter[ií]a de medell[ií]n/gi,
        'evento de selección aleatoria administrado por una entidad pública regional'
    )
);

const sanitizeLinks = (links) => {
    if (!Array.isArray(links)) return [];

    return links
        .filter((link) => link && typeof link.label === 'string' && link.label.trim().length > 0)
        .map((link, index) => ({
            label: link.label.trim(),
            url: typeof link.url === 'string' && link.url.trim().length > 0 ? link.url.trim() : '#',
            content: typeof link.content === 'string'
                ? normalizeSelectionEventReference(link.content.trim())
                : '',
            active: typeof link.active === 'boolean' ? link.active : true,
            order: Number.isFinite(Number(link.order)) ? Number(link.order) : index + 1
        }))
        .sort((a, b) => a.order - b.order);
};

const normalizeLabel = (value) => value.trim().toLowerCase();

const getNormalizedInternalLegalUrl = (currentUrl, defaultLink, legalVersion) => {
    const fallbackUrl = buildLegalDocUrl(legalVersion, defaultLink.slug);

    if (typeof currentUrl !== 'string') return fallbackUrl;
    const trimmedUrl = currentUrl.trim();
    if (!trimmedUrl || trimmedUrl === '#' || trimmedUrl.startsWith('#')) return fallbackUrl;

    if (LEGAL_VERSIONED_PATH_PATTERN.test(trimmedUrl)) {
        return fallbackUrl;
    }

    return trimmedUrl;
};

const ensureDefaultLinks = (links, defaults, legalVersion) => {
    const merged = [...links];

    defaults.forEach((defaultLink) => {
        const normalizedDefaultLabel = normalizeLabel(defaultLink.label);
        const existingIndex = merged.findIndex((link) => (
            normalizeLabel(link.label) === normalizedDefaultLabel
            || Number(link.order) === Number(defaultLink.order)
        ));

        if (existingIndex === -1) {
            merged.push({ ...defaultLink });
            return;
        }

        const existingLink = merged[existingIndex];
        const mergedUrl = defaultLink.slug
            ? getNormalizedInternalLegalUrl(existingLink.url, defaultLink, legalVersion)
            : (typeof existingLink.url === 'string' && existingLink.url.trim().length > 0 ? existingLink.url.trim() : defaultLink.url);

        merged[existingIndex] = {
            ...defaultLink,
            ...existingLink,
            url: mergedUrl,
            content: typeof existingLink.content === 'string' && existingLink.content.trim().length > 0
                ? existingLink.content.trim()
                : (defaultLink.content || '')
        };
    });

    return merged
        .map((link, index) => {
            const { slug, ...safeLink } = link;
            return {
                ...safeLink,
                content: typeof safeLink.content === 'string'
                    ? normalizeSelectionEventReference(safeLink.content.trim())
                    : '',
                order: Number.isFinite(Number(safeLink.order)) ? Number(safeLink.order) : index + 1
            };
        })
        .sort((a, b) => a.order - b.order);
};

const createAutoLegalVersion = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `LEGAL-TP-${year}${month}${day}-${hours}${minutes}`;
};

const mergeWithDefaults = (infoDoc) => {
    const legalVersion = sanitizeLegalVersion(infoDoc?.legalVersion, DEFAULT_INFO.legalVersion);
    const defaults = buildDefaultInfo(legalVersion);
    const legalUpdatedAt = infoDoc?.legalUpdatedAt ? new Date(infoDoc.legalUpdatedAt) : defaults.legalUpdatedAt;
    const safeLegalUpdatedAt = Number.isNaN(legalUpdatedAt.getTime()) ? defaults.legalUpdatedAt : legalUpdatedAt;
    const legal = sanitizeLinks(infoDoc?.legal);
    const social = sanitizeLinks(infoDoc?.social);
    const legalWithDefaults = ensureDefaultLinks(legal.length ? legal : defaults.legal, defaults.legal, legalVersion);
    const socialWithDefaults = ensureDefaultLinks(social.length ? social : defaults.social, defaults.social, legalVersion);

    return {
        legalVersion,
        legalUpdatedAt: safeLegalUpdatedAt,
        legal: legalWithDefaults,
        social: socialWithDefaults
    };
};

const trustplayInfoController = {
    getInfo: async (req, res) => {
        try {
            let info = await TrustplayInfo.findOne();

            if (!info) {
                info = new TrustplayInfo(buildDefaultInfo(DEFAULT_LEGAL_VERSION));
                await info.save();
            }

            const normalizedInfo = mergeWithDefaults(info);

            // Keep DB aligned with normalized data (self-healing defaults)
            info.legalVersion = normalizedInfo.legalVersion;
            info.legalUpdatedAt = normalizedInfo.legalUpdatedAt;
            info.legal = normalizedInfo.legal;
            info.social = normalizedInfo.social;
            await info.save();

            return res.status(200).json({
                ok: true,
                info
            });
        } catch (error) {
            console.error('Error fetching trustplay info:', error);
            return res.status(500).json({
                ok: false,
                msg: 'Error fetching trustplay info'
            });
        }
    },

    updateInfo: async (req, res) => {
        try {
            const { legal, social, legalVersion } = req.body;

            let info = await TrustplayInfo.findOne();
            if (!info) {
                info = new TrustplayInfo(buildDefaultInfo(DEFAULT_LEGAL_VERSION));
            }

            const normalizedRequestedVersion = legalVersion !== undefined
                ? sanitizeLegalVersion(legalVersion, sanitizeLegalVersion(info.legalVersion, DEFAULT_INFO.legalVersion))
                : null;

            if (legal !== undefined) {
                info.legal = sanitizeLinks(legal);
                if (normalizedRequestedVersion) {
                    info.legalVersion = normalizedRequestedVersion;
                } else {
                    info.legalVersion = createAutoLegalVersion();
                }
                info.legalUpdatedAt = new Date();
            } else if (normalizedRequestedVersion && normalizedRequestedVersion !== info.legalVersion) {
                info.legalVersion = normalizedRequestedVersion;
                info.legalUpdatedAt = new Date();
            }

            if (social !== undefined) {
                info.social = sanitizeLinks(social);
            }

            const normalizedInfo = mergeWithDefaults(info);
            info.legalVersion = normalizedInfo.legalVersion;
            info.legalUpdatedAt = normalizedInfo.legalUpdatedAt;
            info.legal = normalizedInfo.legal;
            info.social = normalizedInfo.social;

            await info.save();

            return res.status(200).json({
                ok: true,
                msg: 'TrustPlay info updated successfully',
                info
            });
        } catch (error) {
            console.error('Error updating trustplay info:', error);
            return res.status(500).json({
                ok: false,
                msg: 'Error updating trustplay info'
            });
        }
    }
};

module.exports = trustplayInfoController;
