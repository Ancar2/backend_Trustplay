/**
 * Generates videoKnowledge.json with transcripts from all TrustPlay/OddsWin YouTube videos.
 * Run: node scripts/buildVideoKnowledge.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const VIDEOS = [
    { id: "PqIiaqHyLhg", label: "Introduccion a TrustPlay", lang_pref: "es" },
    { id: "eE6VH8GSX0Y", label: "Como iniciar en Oddswin", lang_pref: "es" },
    { id: "8xVqr8F9Fbs", label: "Guia completa de Oddswin", lang_pref: "es" },
    { id: "BdNDTeZUuwc", label: "Oddswin paso a paso", lang_pref: "es" },
    { id: "pLqQXMs0yJA", label: "TrustPlay introduction", lang_pref: "en" },
    { id: "90nPMl_xXPo", label: "How to get started in Oddswin", lang_pref: "en" },
];

function httpsPost(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
                "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
            },
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
        });
        req.on("error", reject);
        req.write(data);
        req.end();
    });
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)" }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => resolve(raw));
        }).on("error", reject);
    });
}

function parseXml(xml) {
    const words = [];
    const sTagRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let match;
    while ((match = sTagRegex.exec(xml)) !== null) {
        const word = match[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .trim();
        if (word) words.push(word);
    }
    if (words.length === 0) {
        const textTagRegex = /<text[^>]*>([^<]*)<\/text>/g;
        while ((match = textTagRegex.exec(xml)) !== null) {
            const word = match[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
            if (word) words.push(word);
        }
    }
    return words.join(" ").replace(/\s+/g, " ").trim();
}

async function getTranscript(videoId, langPref) {
    const data = await httpsPost("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        videoId,
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } }
    });

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) throw new Error("No caption tracks found");

    const track =
        tracks.find(t => t.languageCode === langPref) ||
        tracks.find(t => t.languageCode === "es") ||
        tracks.find(t => t.languageCode === "en") ||
        tracks[0];

    const xml = await httpsGet(track.baseUrl);
    const text = parseXml(xml);
    return { text, lang: track.languageCode };
}

(async () => {
    const knowledge = {};

    for (const video of VIDEOS) {
        process.stdout.write(`Fetching: ${video.label} (${video.id})... `);
        try {
            const { text, lang } = await getTranscript(video.id, video.lang_pref);
            console.log(`OK [${lang}] ${text.length} chars`);
            knowledge[video.id] = { label: video.label, lang, text };
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
            knowledge[video.id] = { label: video.label, error: err.message, text: "" };
        }
    }

    const outDir = path.join(__dirname, "../services/trustplay");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, "videoKnowledge.json");
    fs.writeFileSync(outPath, JSON.stringify(knowledge, null, 2), "utf-8");
    console.log(`\nSaved to: ${outPath}`);
})();
