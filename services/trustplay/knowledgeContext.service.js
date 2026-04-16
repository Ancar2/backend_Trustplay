const fs = require("fs");
const path = require("path");

const VIDEO_SOURCES = [
    { id: "8xVqr8F9Fbs", title: "Guia completa de Oddswin", lang: "es", url: "https://youtu.be/8xVqr8F9Fbs", type: "video" },
    { id: "eE6VH8GSX0Y", title: "Como iniciar en Oddswin", lang: "es", url: "https://youtu.be/eE6VH8GSX0Y", type: "video" },
    { id: "BdNDTeZUuwc", title: "Oddswin paso a paso", lang: "es", url: "https://youtu.be/BdNDTeZUuwc", type: "video" },
    { id: "PqIiaqHyLhg", title: "Introduccion a TrustPlay", lang: "es", url: "https://youtu.be/PqIiaqHyLhg", type: "video" },
    { id: "90nPMl_xXPo", title: "How to get started in Oddswin", lang: "en", url: "https://youtu.be/90nPMl_xXPo", type: "video" },
    { id: "pLqQXMs0yJA", title: "TrustPlay introduction", lang: "en", url: "https://youtu.be/pLqQXMs0yJA", type: "video" }
];

const GITBOOK_SOURCES = [
    { title: "TrustPlay GitBook - Home", url: "https://trustplay.gitbook.io/trustplay/", type: "gitbook" },
    { title: "TrustPlay GitBook - Quickstart", url: "https://trustplay.gitbook.io/trustplay/introduccion/quickstart", type: "gitbook" },
    { title: "TrustPlay GitBook - Oddswin", url: "https://trustplay.gitbook.io/trustplay/oddswin/editor", type: "gitbook" },
    { title: "TrustPlay GitBook - Transparencia y seguridad", url: "https://trustplay.gitbook.io/trustplay/introduccion/transparencia-y-seguridad", type: "gitbook" }
];

const CACHE = { expiresAt: 0, items: [] };

const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const KNOWLEDGE_CACHE_MINUTES = toPositiveNumber(process.env.GEMINI_KNOWLEDGE_CACHE_MINUTES, 60);
const KNOWLEDGE_FETCH_TIMEOUT_MS = toPositiveNumber(process.env.GEMINI_KNOWLEDGE_FETCH_TIMEOUT_MS, 15000);
const MAX_CONTEXT_ITEMS = toPositiveNumber(process.env.GEMINI_KNOWLEDGE_MAX_ITEMS, 4);
const MAX_ITEM_CHARS = toPositiveNumber(process.env.GEMINI_KNOWLEDGE_MAX_CHARS_PER_ITEM, 4000);

const stripHtml = (html) => {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

const truncate = (text, limit) => {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 3)}...`;
};

const extractTokens = (text) => {
    const matches = String(text || "").toLowerCase().match(/[a-z0-9áéíóúüñ]{3,}/gi);
    return new Set(matches || []);
};

const fetchGitBookText = async (source) => {
    try {
        const response = await fetch(source.url, {
            signal: AbortSignal.timeout(KNOWLEDGE_FETCH_TIMEOUT_MS),
            headers: { "User-Agent": "TrustPlayBot/1.0" }
        });
        if (!response.ok) return null;
        const html = await response.text();
        return stripHtml(html);
    } catch (err) {
        console.warn(`Failed to fetch GitBook ${source.url}: ${err.message}`);
        return null;
    }
};

const loadKnowledgeItems = async () => {
    let videoData = {};
    try {
        const videoPath = path.join(__dirname, "videoKnowledge.json");
        if (fs.existsSync(videoPath)) {
            videoData = JSON.parse(fs.readFileSync(videoPath, "utf-8"));
        }
    } catch (err) {
        console.warn("Failed to load videoKnowledge.json:", err.message);
    }

    const items = [];

    // Process Video Sources
    for (const source of VIDEO_SOURCES) {
        const data = videoData[source.id];
        const text = data?.text || "";
        if (text) {
            items.push({
                type: "video",
                title: source.title,
                url: source.url,
                text: truncate(text, MAX_ITEM_CHARS),
                tokens: extractTokens(`${source.title} ${text}`),
                priority: 10 // Higher priority for videos
            });
        }
    }

    // Process GitBook Sources (Scraped dynamically)
    const gitbookPromises = GITBOOK_SOURCES.map(async (source) => {
        const text = await fetchGitBookText(source);
        if (text) {
            return {
                type: "gitbook",
                title: source.title,
                url: source.url,
                text: truncate(text, MAX_ITEM_CHARS),
                tokens: extractTokens(`${source.title} ${text}`),
                priority: 5 // Lower priority for gitbook
            };
        }
        return null;
    });

    const gitbookResults = await Promise.all(gitbookPromises);
    gitbookResults.filter(Boolean).forEach(item => items.push(item));

    return items;
};

const getKnowledgeItems = async () => {
    const now = Date.now();
    if (CACHE.items.length > 0 && CACHE.expiresAt > now) return CACHE.items;

    const items = await loadKnowledgeItems();
    CACHE.items = items;
    CACHE.expiresAt = now + (KNOWLEDGE_CACHE_MINUTES * 60 * 1000);
    return items;
};

const rankItems = (items, question) => {
    const questionTokens = extractTokens(question);
    if (questionTokens.size === 0) return items.slice(0, MAX_CONTEXT_ITEMS);

    const scored = items.map(item => {
        let score = 0;
        for (const token of questionTokens) {
            if (item.tokens.has(token)) score += 1;
        }
        // Boost priority in ranking
        const finalScore = score + (score > 0 ? item.priority : 0);
        return { item, finalScore };
    });

    return scored
        .filter(s => s.finalScore > 0)
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, MAX_CONTEXT_ITEMS)
        .map(s => s.item);
};

const buildKnowledgeContext = async (question) => {
    const items = await getKnowledgeItems();
    if (!items.length) return "";

    const selected = rankItems(items, question);
    if (!selected.length) return "";

    return [
        "=== CONTEXTO ADICIONAL (ORDEN DE PRIORIDAD: VIDEOS > DOCUMENTACION) ===",
        "Usa la siguiente informacion extraida de las fuentes oficiales para responder. Los videos son la fuente primaria de verdad.",
        "",
        ...selected.map(item => `[${item.type.toUpperCase()}] ${item.title}\nFuente: ${item.url}\nContenido:\n${item.text}\n`)
    ].join("\n");
};

module.exports = { buildKnowledgeContext };
