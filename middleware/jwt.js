const jwt = require('jsonwebtoken');
const { listDocuments } = require('../services/legal/legal.service');

const isLegalGuardExemptPath = (req) => {
    const path = String(req?.originalUrl || req?.url || '').split('?')[0];
    if (!path) return false;
    if (path.startsWith('/api/legal')) return true;
    if (path === '/api/users/me') return true;
    return false;
};

const buildLegalGuardResponse = (pendingDocuments = []) => ({
    msj: 'Debes aceptar los documentos legales vigentes para continuar.',
    code: 'LEGAL_ACCEPTANCE_REQUIRED',
    pendingDocuments,
    legalVersion: pendingDocuments[0]?.version || ''
});

// Middleware Principal de Autenticación
// Verifica que el Request incluya un Token JWT válido en Cookies o Headers.
// Decodifica el token e inyecta la info del usuario en req.user
exports.verifyToken = (req, res, next) => {
    try {
        let token;

        if (req.cookies.token) {
            token = req.cookies.token;
        } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ msj: 'Token no proporcionado' });
        }

        jwt.verify(token, process.env.SECRET_JWT_KEY, async (err, decoded) => {
            if (err) {
                return res.status(401).json({ msj: 'Token inválido o expirado' });
            }
            if (!decoded?.id) {
                return res.status(401).json({ msj: 'Token inválido o expirado' });
            }
            req.user = decoded;

            if (String(decoded.role || '').toLowerCase() === 'admin' || isLegalGuardExemptPath(req)) {
                return next();
            }

            try {
                const legalStatus = await listDocuments({ userId: decoded.id });
                if (legalStatus?.hasPending === true) {
                    return res.status(403).json(buildLegalGuardResponse(legalStatus.pendingDocuments || []));
                }
            } catch (error) {
                // Si hay un problema temporal consultando legales, no bloqueamos todo el tráfico autenticado.
                console.error('Error validando aceptación legal en middleware JWT:', error);
            }

            return next();
        });
    } catch (error) {
        return res.status(500).json({ msj: 'Error en la autenticación' });
    }
};

// Middleware de Autorización (Role Guard)
// Verifica que el usuario autenticado tenga el rol 'admin'.
// DEBE usarse después de verifyToken.
exports.isAdmin = (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ msj: 'Acceso denegado. Usuario no autenticado.' });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({ msj: 'Acceso denegado. Se requieren permisos de administrador.' });
        }

        next();
    } catch (error) {
        console.error("Error en isAdmin middleware:", error);
        return res.status(500).json({ msj: 'Error verificando permisos de administrador' });
    }
};
