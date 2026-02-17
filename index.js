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

const app = express();
// Evita exponer tecnologia del servidor en headers HTTP.
app.disable("x-powered-by");

// Agrega headers de seguridad comunes y soporte de cookies.
app.use(helmet());
app.use(cookieParser());

// Limita peticiones por IP para reducir abuso y ataques de fuerza bruta.
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 2000),
    standardHeaders: true,
    legacyHeaders: false,
    message: { msj: "Demasiadas peticiones desde esta IP, por favor intenta nuevamente en 15 minutos." }
});
app.use(limiter);

// CORS controla que dominios del navegador pueden consumir la API.
const corsOptions = {
    origin: (origin, callback) => {
        // Dominios permitidos
        const allowed = [
            "http://localhost:4200",
            process.env.FRONTEND_URL
        ].filter(Boolean);

        // Si no hay origin (curl/postman) o el dominio esta en allowlist, se permite.
        if (!origin || allowed.includes(origin)) {
            callback(null, true);
            return;
        }

        // Si el origen no esta permitido, se bloquea.
        console.log("CORS Blocked Origin:", origin);
        callback(new Error("Not allowed by CORS"));
    },
    // Necesario para enviar/recibir cookies de sesion entre frontend y API.
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

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
