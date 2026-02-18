const TrustplayInfo = require('../../models/trustplay/trustplayInfo.model');
const { listDocuments } = require('../../services/legal/legal.service');

const DEFAULT_SOCIAL_LINKS = [
    { label: 'TWITTER / X', url: '#', order: 1, active: true },
    { label: 'FACEBOOK', url: '#', order: 2, active: true },
    { label: 'INSTAGRAM', url: '#', order: 3, active: true },
    { label: 'DISCORD', url: '#', order: 4, active: true },
    { label: 'TELEGRAM', url: '#', order: 5, active: true },
    { label: 'LINKEDIN', url: '#', order: 6, active: true }
];

const normalizeSocialLinks = (links) => {
    const source = Array.isArray(links) && links.length > 0 ? links : DEFAULT_SOCIAL_LINKS;

    return source
        .filter((link) => link && typeof link.label === 'string' && link.label.trim().length > 0)
        .map((link, index) => ({
            label: link.label.trim(),
            url: typeof link.url === 'string' && link.url.trim().length > 0 ? link.url.trim() : '#',
            content: '',
            active: typeof link.active === 'boolean' ? link.active : true,
            order: Number.isFinite(Number(link.order)) ? Number(link.order) : index + 1
        }))
        .sort((a, b) => a.order - b.order);
};

const buildLegalLinksFromDocuments = (documents = []) => (
    documents
        .filter((item) => item && typeof item.key === 'string' && typeof item.title === 'string')
        .map((item, index) => ({
            label: item.title,
            url: `/legal/${encodeURIComponent(item.key)}`,
            content: '',
            active: true,
            order: index + 1
        }))
);

const ensureInfoDocument = async () => {
    let info = await TrustplayInfo.findOne();
    if (!info) {
        info = new TrustplayInfo({
            social: DEFAULT_SOCIAL_LINKS
        });
        await info.save();
    }
    return info;
};

const buildInfoPayload = ({ info, legalDocuments }) => ({
    legal: buildLegalLinksFromDocuments(legalDocuments),
    social: normalizeSocialLinks(info?.social),
    createdAt: info?.createdAt || null,
    updatedAt: info?.updatedAt || null
});

const trustplayInfoController = {
    getInfo: async (req, res) => {
        try {
            const info = await ensureInfoDocument();
            const legalResponse = await listDocuments();
            const legalDocuments = Array.isArray(legalResponse?.documents) ? legalResponse.documents : [];

            return res.status(200).json({
                ok: true,
                info: buildInfoPayload({ info, legalDocuments })
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
            const hasLegacyLegalFields = (
                Object.prototype.hasOwnProperty.call(req.body || {}, 'legal')
                || Object.prototype.hasOwnProperty.call(req.body || {}, 'legalVersion')
                || Object.prototype.hasOwnProperty.call(req.body || {}, 'legalVersions')
            );

            if (hasLegacyLegalFields) {
                return res.status(400).json({
                    ok: false,
                    msg: 'La informacion legal ya no se actualiza por trustplay-info. Usa los endpoints /api/legal/*.'
                });
            }

            const info = await ensureInfoDocument();
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'social')) {
                info.social = normalizeSocialLinks(req.body?.social);
                await info.save();
            }

            const legalResponse = await listDocuments();
            const legalDocuments = Array.isArray(legalResponse?.documents) ? legalResponse.documents : [];

            return res.status(200).json({
                ok: true,
                msg: 'TrustPlay info updated successfully',
                info: buildInfoPayload({ info, legalDocuments })
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
