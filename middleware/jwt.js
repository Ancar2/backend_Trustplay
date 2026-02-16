const jwt = require('jsonwebtoken');

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

        jwt.verify(token, process.env.SECRET_JWT_KEY, (err, decoded) => {
            if (err) {
                return res.status(401).json({ msj: 'Token inválido o expirado' });
            }
            req.user = decoded;
            next();
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
