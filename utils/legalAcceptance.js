const TrustplayInfo = require('../models/trustplay/trustplayInfo.model');
const LegalAcceptanceLog = require('../models/trustplay/legalAcceptanceLog.model');

const DEFAULT_LEGAL_VERSION = 'LEGAL-TP-2026-02';

const sanitizeLegalVersion = (value, fallback = DEFAULT_LEGAL_VERSION) => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
};

const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.ip || '';
};

const getUserAgent = (req) => {
    const userAgent = req.headers['user-agent'];
    if (typeof userAgent !== 'string') return '';
    return userAgent.slice(0, 512);
};

const normalizeAcknowledgements = (payload) => ({
    terms: payload?.terms === true,
    privacy: payload?.privacy === true,
    cookies: payload?.cookies === true,
    disclaimer: payload?.disclaimer === true
});

const hasAllAcknowledgements = (acknowledgements) => (
    acknowledgements.terms
    && acknowledgements.privacy
    && acknowledgements.cookies
    && acknowledgements.disclaimer
);

const validateLegalAcceptance = (payload, requiredVersion) => {
    if (!payload || typeof payload !== 'object') {
        return { ok: false, msg: 'Debes aceptar los documentos legales vigentes para continuar.' };
    }

    const acknowledgements = normalizeAcknowledgements(payload);
    const accepted = payload.accepted === true && hasAllAcknowledgements(acknowledgements);

    if (!accepted) {
        return {
            ok: false,
            msg: 'Debes aceptar Términos, Privacidad, Cookies y Disclaimer para continuar.'
        };
    }

    const requestedVersion = sanitizeLegalVersion(payload.version, '');
    if (!requestedVersion) {
        return { ok: false, msg: 'No se recibió una versión legal válida.' };
    }

    if (requiredVersion && requestedVersion !== requiredVersion) {
        return {
            ok: false,
            msg: 'La versión legal cambió. Recarga la página y vuelve a aceptar los documentos vigentes.'
        };
    }

    return {
        ok: true,
        normalized: {
            accepted: true,
            version: requestedVersion,
            acknowledgements
        }
    };
};

const buildLegalAcceptanceRecord = ({ normalized, source, req }) => ({
    accepted: true,
    version: normalized.version,
    acknowledgements: normalized.acknowledgements,
    acceptedAt: new Date(),
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    source
});

const registerLegalAcceptanceAudit = async ({ user, legalAcceptance }) => {
    if (!user || !legalAcceptance || legalAcceptance.accepted !== true) return;

    const acceptedAt = legalAcceptance.acceptedAt ? new Date(legalAcceptance.acceptedAt) : new Date();
    const safeAcceptedAt = Number.isNaN(acceptedAt.getTime()) ? new Date() : acceptedAt;

    await LegalAcceptanceLog.create({
        userId: user._id,
        username: String(user.username || ''),
        email: String(user.email || '').toLowerCase(),
        wallets: Array.isArray(user.wallets)
            ? user.wallets.map((wallet) => String(wallet || '').toLowerCase()).filter(Boolean)
            : [],
        legalVersion: sanitizeLegalVersion(legalAcceptance.version, DEFAULT_LEGAL_VERSION),
        acknowledgements: {
            terms: legalAcceptance?.acknowledgements?.terms === true,
            privacy: legalAcceptance?.acknowledgements?.privacy === true,
            cookies: legalAcceptance?.acknowledgements?.cookies === true,
            disclaimer: legalAcceptance?.acknowledgements?.disclaimer === true
        },
        acceptedAt: safeAcceptedAt,
        ipAddress: String(legalAcceptance.ipAddress || ''),
        userAgent: String(legalAcceptance.userAgent || ''),
        source: String(legalAcceptance.source || 'login_form')
    });
};

const getCurrentLegalVersion = async () => {
    const info = await TrustplayInfo.findOne().select('legalVersion');
    return sanitizeLegalVersion(info?.legalVersion, DEFAULT_LEGAL_VERSION);
};

module.exports = {
    DEFAULT_LEGAL_VERSION,
    sanitizeLegalVersion,
    validateLegalAcceptance,
    buildLegalAcceptanceRecord,
    getCurrentLegalVersion,
    registerLegalAcceptanceAudit
};
