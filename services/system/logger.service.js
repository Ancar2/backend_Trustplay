const LEVEL_WEIGHT = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const normalizeLevel = (value) => {
    const level = String(value ?? "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, level) ? level : "info";
};

const shouldLog = (currentLevel, requestedLevel) => (
    LEVEL_WEIGHT[requestedLevel] >= LEVEL_WEIGHT[currentLevel]
);

const safeSerialize = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return value;

    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
};

const createLogger = (scope = "trustplay") => {
    const currentLevel = normalizeLevel(process.env.LOG_LEVEL);

    const log = (level, message, meta = {}) => {
        const normalizedLevel = normalizeLevel(level);
        if (!shouldLog(currentLevel, normalizedLevel)) return;

        const serializedMeta = safeSerialize(meta);
        const payload = {
            ts: new Date().toISOString(),
            level: normalizedLevel,
            scope,
            message,
            ...(serializedMeta && typeof serializedMeta === "object" ? serializedMeta : { meta: serializedMeta }),
        };

        const line = JSON.stringify(payload);
        if (normalizedLevel === "error") {
            console.error(line);
            return;
        }
        if (normalizedLevel === "warn") {
            console.warn(line);
            return;
        }
        console.log(line);
    };

    return {
        debug: (message, meta) => log("debug", message, meta),
        info: (message, meta) => log("info", message, meta),
        warn: (message, meta) => log("warn", message, meta),
        error: (message, meta) => log("error", message, meta),
    };
};

module.exports = {
    createLogger,
    normalizeLevel,
};
