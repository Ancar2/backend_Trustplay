#!/usr/bin/env node

const { execSync } = require("node:child_process");

const isCi = String(process.env.CI || "").toLowerCase() === "true";
const failOnCritical = String(process.env.AUDIT_FAIL_ON_CRITICAL || "true").toLowerCase() !== "false";
const failOnHigh = String(process.env.AUDIT_FAIL_ON_HIGH || "false").toLowerCase() === "true";

const networkErrorPatterns = [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ERR_SOCKET_TIMEOUT",
    "fetch failed",
];

const parseAuditJson = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const extractCounts = (auditJson) => {
    const vulnerabilities = auditJson?.metadata?.vulnerabilities || {};
    return {
        info: Number(vulnerabilities.info || 0),
        low: Number(vulnerabilities.low || 0),
        moderate: Number(vulnerabilities.moderate || 0),
        high: Number(vulnerabilities.high || 0),
        critical: Number(vulnerabilities.critical || 0),
        total: Number(vulnerabilities.total || 0),
    };
};

const printCounts = (counts) => {
    console.log("Resultado npm audit (dependencias de runtime):");
    console.log(`- total: ${counts.total}`);
    console.log(`- critical: ${counts.critical}`);
    console.log(`- high: ${counts.high}`);
    console.log(`- moderate: ${counts.moderate}`);
    console.log(`- low: ${counts.low}`);
    console.log(`- info: ${counts.info}`);
};

const runAudit = () => {
    try {
        const output = execSync("npm audit --omit=dev --json", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        const parsed = parseAuditJson(output);
        if (!parsed) {
            console.log("No se pudo parsear npm audit. Se omite validacion.");
            return 0;
        }
        const counts = extractCounts(parsed);
        printCounts(counts);
        return counts;
    } catch (error) {
        const stdout = String(error?.stdout || "");
        const stderr = String(error?.stderr || "");
        const combined = `${stdout}\n${stderr}`;
        const parsed = parseAuditJson(stdout) || parseAuditJson(stderr);

        if (parsed) {
            const counts = extractCounts(parsed);
            printCounts(counts);
            return counts;
        }

        const isNetworkError = networkErrorPatterns.some((pattern) => combined.includes(pattern));
        if (isNetworkError) {
            const message = "No se pudo ejecutar npm audit por conectividad de red.";
            if (isCi) {
                console.error(`${message} En CI se marca como fallo.`);
                process.exit(1);
            }
            console.warn(`${message} Se omite en entorno local.`);
            return 0;
        }

        console.error("Error ejecutando npm audit:");
        console.error(combined || error.message);
        process.exit(1);
    }
};

const result = runAudit();
if (!result || typeof result !== "object") {
    process.exit(0);
}

if (failOnCritical && result.critical > 0) {
    console.error("Fallo de seguridad: existen vulnerabilidades CRITICAL en dependencias de runtime.");
    process.exit(1);
}

if (failOnHigh && result.high > 0) {
    console.error("Fallo de seguridad: existen vulnerabilidades HIGH en dependencias de runtime.");
    process.exit(1);
}

console.log("OK: auditoria de dependencias completada.");
process.exit(0);
