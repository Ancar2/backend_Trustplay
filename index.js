// Carga variables de entorno desde .env al iniciar el proceso.
require("dotenv").config();

// Dependencias base de la API.
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Modulos internos.
const connectionDB = require("./config/db");
const apiRouter = require("./routes/api.router");
const { validateEnv } = require("./config/env");
const { startOddswinReconcileScheduler } = require("./services/oddswin/reconcile.service");
const { seedLegalDocuments } = require("./services/legal/legal.service");

const app = express();
// Evita exponer tecnologia del servidor en headers HTTP.
app.disable("x-powered-by");

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

const normalizeOrigin = (value) => {
    if (!value) return "";
    try {
        return new URL(String(value).trim()).origin;
    } catch {
        return "";
    }
};

const asBoolean = (value, fallback = null) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return fallback;
};

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

const allowedOrigins = parseAllowedOrigins();
const sameDomainDeployment = asBoolean(process.env.AUTH_SAME_DOMAIN, true);
const isProductionEnv = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

// En produccion detras de Nginx/CloudFront, Express debe confiar en proxy para resolver IP real.
app.set("trust proxy", isProductionEnv ? true : false);

// Agrega headers de seguridad comunes y soporte de cookies.
app.use(helmet());
app.use(cookieParser());

// Limita peticiones por IP para reducir abuso y ataques de fuerza bruta.
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

// CORS controla que dominios del navegador pueden consumir la API.
const corsOptionsDelegate = (req, callback) => {
    const origin = req.header("origin");

    // Si no hay origin (curl/postman) se permite.
    if (!origin) {
        callback(null, { origin: true, credentials: true, optionsSuccessStatus: 200 });
        return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
        callback(null, { origin: true, credentials: true, optionsSuccessStatus: 200 });
        return;
    }

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
app.use(cors(corsOptionsDelegate));

// Parsea JSON del body y limita tamano para evitar cargas excesivas.
app.use(express.json({ limit: "1mb" }));

// Monta todas las rutas de negocio bajo /api.
app.use("/api", apiRouter);

// Endpoint de salud para monitoreo basico.
app.get("/api/health", (req, res) => {
    res.json({ msj: "Api Oddswin is OK" });
});

// Handler de 404 para rutas no definidas.
app.use((req, res) => {
    res.status(404).json({ msj: "Endpoint no encontrado" });
});

// Handler global de errores (siempre al final del pipeline).
app.use((err, req, res, next) => {
    if (err && err.message === "Not allowed by CORS") {
        return res.status(403).json({ msj: "Origen no permitido por CORS" });
    }

    console.error("Unhandled error:", err);
    return res.status(500).json({ msj: "Error interno del servidor" });
});

const startServer = async () => {
    // Falla rapido si falta configuracion critica.
    validateEnv();
    // Conecta base de datos antes de aceptar trafico.
    await connectionDB();
    // Asegura documentos legales base versionados para no dejar auth bloqueado.
    await seedLegalDocuments();
    // Si esta habilitado por variables de entorno, inicia la reconciliacion automatica.
    startOddswinReconcileScheduler();

    const port = Number(process.env.PORT);
    app.listen(port, () => {
        console.log(`CORRIENDO EN EL PUERTO ${port}`);
    });
};

startServer().catch((error) => {
    console.error("Error iniciando la API:", error.message);
    process.exit(1);
});
