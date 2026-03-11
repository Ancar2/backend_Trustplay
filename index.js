// Framework HTTP principal.
const express = require("express");
// Headers de seguridad.
const helmet = require("helmet");
// Rate limit global por IP.
const rateLimit = require("express-rate-limit");
// Control de CORS.
const cors = require("cors");
// Lectura de cookies entrantes.
const cookieParser = require("cookie-parser");

// Cargador de variables desde .env local y/o AWS Secrets Manager.
const { loadSecrets } = require("./loadSecrets");

// Resuelve la IP real del cliente priorizando proxies como Cloudflare y luego x-forwarded-for.
const resolveClientIp = (req) => {
    const cloudflareIp = String(req.header("cf-connecting-ip") || "").trim();
    if (cloudflareIp) return cloudflareIp;

    const forwardedFor = String(req.header("x-forwarded-for") || "");
    const firstForwardedIp = forwardedFor
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
    if (firstForwardedIp) return firstForwardedIp;

    return String(req.ip || req.socket?.remoteAddress || "unknown");
};

// Normaliza cualquier URL/origin al formato protocol://host[:port].
const normalizeOrigin = (value) => {
    if (!value) return "";
    try {
        return new URL(String(value).trim()).origin;
    } catch {
        return "";
    }
};

// Convierte variables de entorno string a booleano con fallback controlado.
const asBoolean = (value, fallback = null) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
};

// Construye la lista de origins permitidos para CORS desde variables de entorno.
// En desarrollo agrega localhost:4200 para no bloquear el front local.
const parseAllowedOrigins = () => {
    const configured = [
        process.env.FRONTEND_URL,
        ...String(process.env.FRONTEND_URLS || "")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
    ]
        .map(normalizeOrigin)
        .filter(Boolean);

    if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") {
        configured.push("http://localhost:4200");
    }

    return [...new Set(configured)];
};

// Excepciones puntuales para solicitudes sin Origin (navegador/crawler/health checks).
const isNoOriginPathAllowed = (req) => {
    const path = String(req.path || req.originalUrl || "").split("?")[0];
    if (!path) return false;

    if (path === "/api/health") return true;
    if (path.startsWith("/share/")) return true;

    // Callback OAuth opcional (si se habilita flujo server-side en el futuro).
    if (path.startsWith("/api/auth/callback")) return true;

    return false;
};

const getRequestPath = (req) => String(req.path || req.originalUrl || "").split("?")[0];

// Excepciones para validación de header secreto inyectado por Cloudflare.
const isEdgeGuardBypassPath = (req) => {
    const path = getRequestPath(req);
    if (!path) return false;
    if (path === "/api/health") return true;
    if (path.startsWith("/share/")) return true;
    return false;
};

const resolveEdgeGuardConfig = ({ isProductionEnv }) => {
    const enabled = isProductionEnv
        ? asBoolean(process.env.EDGE_AUTH_ENABLED, true)
        : asBoolean(process.env.EDGE_AUTH_ENABLED, false);

    const headerName = String(process.env.EDGE_SHARED_HEADER || "x-trustplay-edge-key")
        .trim()
        .toLowerCase();
    const secret = String(process.env.EDGE_SHARED_SECRET || "").trim();

    return {
        enabled: Boolean(enabled),
        headerName,
        secret
    };
};

// Crea y configura la instancia de Express con todos los middlewares y rutas.
const buildApp = ({ apiRouter, trustplayInfoController, isProductionEnv, allowedOrigins, sameDomainDeployment }) => {
    const app = express();

    // Oculta el header x-powered-by para no exponer tecnología innecesariamente.
    app.disable("x-powered-by");

    // Permite que Express confíe en proxies en producción para obtener IP/protocolo reales.
    app.set("trust proxy", isProductionEnv ? true : false);

    // Seguridad base HTTP y parseo de cookies.
    app.use(helmet());
    app.use(cookieParser());

    // Rate limit global para proteger la API contra abuso y ráfagas.
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: Number(process.env.RATE_LIMIT_MAX || 2000),
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => resolveClientIp(req),
        skip: (req) => req.method === "OPTIONS" || req.path === "/api/health",
        message: { msj: "Demasiadas peticiones desde esta IP, por favor intenta nuevamente en 15 minutos." }
    });
    app.use(limiter);

    // Delegado de CORS para decidir dinámicamente si un origin puede consumir la API.
    const corsOptionsDelegate = (req, callback) => {
        const origin = req.header("origin");

        // Si no hay origin, solo se permiten rutas técnicas/publicas explícitas.
        if (!origin) {
            if (isNoOriginPathAllowed(req)) {
                callback(null, { origin: true, credentials: true, optionsSuccessStatus: 200 });
                return;
            }
            callback(new Error("Not allowed by CORS"));
            return;
        }

        // Permite origins explícitamente configurados.
        const normalizedOrigin = normalizeOrigin(origin);
        if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
            callback(null, { origin: true, credentials: true, optionsSuccessStatus: 200 });
            return;
        }

        // Si front y back comparten dominio, permite el origin si coincide con el host real de la petición.
        if (sameDomainDeployment) {
            const forwardedHost = String(req.header("x-forwarded-host") || "").split(",")[0].trim();
            const host = forwardedHost || String(req.header("host") || "").trim();
            const forwardedProto = String(req.header("x-forwarded-proto") || "").split(",")[0].trim();
            const protocol = forwardedProto || req.protocol || "http";
            const requestHostOrigin = normalizeOrigin(`${protocol}://${host}`);

            if (requestHostOrigin && requestHostOrigin === normalizedOrigin) {
                callback(null, { origin: true, credentials: true, optionsSuccessStatus: 200 });
                return;
            }
        }

        console.log("CORS Blocked Origin:", origin, "Allowed:", allowedOrigins, "SameDomain:", sameDomainDeployment);
        callback(new Error("Not allowed by CORS"));
    };

    // Habilita CORS y parseo JSON con límite de tamaño.
    app.use(cors(corsOptionsDelegate));
    app.use(express.json({ limit: "8mb" }));

    // Guardia de edge: solo permite tráfico que llega con header secreto inyectado por Cloudflare.
    const edgeGuard = resolveEdgeGuardConfig({ isProductionEnv });
    app.use((req, res, next) => {
        if (!edgeGuard.enabled) return next();
        if (req.method === "OPTIONS") return next();
        if (isEdgeGuardBypassPath(req)) return next();

        const inboundSecret = String(req.header(edgeGuard.headerName) || "").trim();
        if (inboundSecret && inboundSecret === edgeGuard.secret) {
            return next();
        }

        return res.status(403).json({ msj: "Acceso restringido al edge autorizado." });
    });

    // Ruta publica para compartir salas (ALB puede enrutar /share/* directo al backend).
    app.get("/share/:slug", trustplayInfoController.openShareRoomPage);

    // Todas las rutas de negocio se montan bajo /api.
    app.use("/api", apiRouter);

    // Health check simple para monitoreo y balanceadores.
    app.get("/api/health", (req, res) => {
        res.json({ msj: "Api Oddswin is OK" });
    });

    // Respuesta estándar para rutas inexistentes.
    app.use((req, res) => {
        res.status(404).json({ msj: "Endpoint no encontrado" });
    });

    // Manejador global de errores al final del pipeline.
    app.use((err, req, res, next) => {
        // Si el rechazo vino de CORS, se devuelve 403 en lugar de 500.
        if (err && err.message === "Not allowed by CORS") {
            return res.status(403).json({ msj: "Origen no permitido por CORS" });
        }

        // Cualquier otro error no controlado se registra y responde como error interno.
        console.error("Unhandled error:", err);
        return res.status(500).json({ msj: "Error interno del servidor" });
    });

    return app;
};

// Orquesta el arranque completo del backend.
const startServer = async () => {
    // Primero carga secretos para que cualquier require posterior lea process.env ya final.
    await loadSecrets();

    // Estos módulos se importan después de cargar secretos porque consumen process.env al inicializar.
    const connectionDB = require("./config/db");
    const apiRouter = require("./routes/api.router");
    const trustplayInfoController = require("./controllers/trustplay/trustplayInfo.controller");
    const { validateEnv } = require("./config/env");
    const { startOddswinReconcileScheduler } = require("./services/oddswin/reconcile.service");
    const { seedLegalDocuments } = require("./services/legal/legal.service");

    // Calcula la política de CORS y el modo de despliegue actual.
    const allowedOrigins = parseAllowedOrigins();
    const sameDomainDeployment = asBoolean(process.env.AUTH_SAME_DOMAIN, true);
    const isProductionEnv = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

    // Construye la app ya configurada con middlewares y rutas.
    const app = buildApp({
        apiRouter,
        trustplayInfoController,
        isProductionEnv,
        allowedOrigins,
        sameDomainDeployment,
    });

    // Verifica variables críticas antes de abrir tráfico.
    validateEnv();
    // Abre conexión a MongoDB.
    await connectionDB();
    // Si no existen documentos legales base, los siembra.
    await seedLegalDocuments();
    // Inicia el scheduler de reconciliación si está habilitado por env.
    startOddswinReconcileScheduler();

    // Finalmente abre el puerto HTTP configurado.
    const port = Number(process.env.PORT);
    app.listen(port, () => {
        console.log(`CORRIENDO EN EL PUERTO ${port}`);
    });
};

// Si el arranque falla, se registra el error y el proceso termina con código no exitoso.
startServer().catch((error) => {
    console.error("Error iniciando la API:", error.message);
    process.exit(1);
});
