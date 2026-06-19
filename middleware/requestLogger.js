const crypto = require("crypto");
const { createLogger } = require("../services/system/logger.service");
const { resolveRuntimeConfig } = require("../services/system/featureFlags.service");

const requestLogger = ({ enabled = true } = {}) => {
    const logger = createLogger("http");
    const runtimeConfig = resolveRuntimeConfig();
    const requestIdHeader = runtimeConfig.observability.requestIdHeader || "x-trustplay-request-id";

    return (req, res, next) => {
        if (!enabled) return next();

        const requestId = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        req.requestId = requestId;
        res.setHeader(requestIdHeader, requestId);

        const startedAt = Date.now();
        res.on("finish", () => {
            const durationMs = Date.now() - startedAt;
            logger.info("request_completed", {
                requestId,
                method: req.method,
                path: req.originalUrl || req.url,
                statusCode: res.statusCode,
                durationMs,
            });
        });

        next();
    };
};

module.exports = requestLogger;
