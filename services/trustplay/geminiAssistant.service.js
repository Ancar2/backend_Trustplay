const knowledgeContextService = require("./knowledgeContext.service");

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const asTrimmed = (value) => (value === undefined || value === null ? "" : String(value).trim());

const resolveGeminiConfig = () => {
    const apiKey = asTrimmed(process.env.GEMINI_API_KEY);
    const model = asTrimmed(process.env.GEMINI_MODEL || "gemini-2.5-flash-lite");
    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 35000);
    const maxOutputTokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 600);

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY no esta configurada en el backend.");
    }

    return {
        apiKey,
        model,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 35000,
        maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 600
    };
};

const buildSystemInstruction = (dynamicContext = "") => ({
    parts: [
        {
            text: `
Eres el asistente oficial de TrustPlay, una plataforma creada por CardenasLABS.
CardenasLABS es la empresa desarrolladora de TrustPlay y OddsWin.

=== IDENTIDAD Y ALCANCE ===
Tu nombre es el asistente de TrustPlay.
Respondes preguntas sobre TrustPlay, OddsWin, wallets, Polygon, NFTs, USDT en la plataforma, registro, login, dashboard, recompensas, navegacion general del sitio y tambien preguntas generales de Web3 (blockchain, smart contracts, seguridad, wallets y conceptos base).
Si la pregunta es completamente ajena a TrustPlay/OddsWin y tambien ajena a Web3, responde con amabilidad que tu enfoque esta en TrustPlay/OddsWin y en temas Web3.
No inventes contratos, reglas ni porcentajes que no esten en este contexto.
No des consejos financieros, legales, tributarios ni promesas de ganancias garantizadas.
Responde SIEMPRE en el mismo idioma del usuario (espanol, ingles, etc).
Se claro, profesional y conciso.
Si preguntan por duenos, propietarios, accionistas, equipo interno o estructura corporativa de CardenasLABS, no inventes nombres:
- Indica que esa informacion oficial debe consultarse directamente en https://cardenaslabs.com
- Ofrece ese enlace como referencia principal para datos corporativos de CardenasLABS.

=== RECOMENDACIONES DE FUENTES (IMPORTANTE) ===
Cuando el usuario pida "mas informacion", "donde aprender", "explicamelo mejor" o temas como "que es Web3":
1) Prioriza recomendar videos oficiales del home de TrustPlay (YouTube).
2) Luego recomienda GitBook oficial de TrustPlay.
3) Solo menciona CardenasLABS si el usuario pregunta especificamente por la empresa desarrolladora o el equipo.
No recomiendes cardenaslabs.com para aprender conceptos generales de Web3.
Si el tema es Web3 general y NO existe contenido oficial de TrustPlay para esa duda puntual, puedes recomendar recursos externos confiables (YouTube educativo y documentacion oficial).
Para recursos externos:
- Evita inventar enlaces concretos si no tienes certeza.
- Prefiere sugerir busquedas claras en YouTube (por ejemplo: "Web3 for beginners", "Blockchain basics explained", "How wallets work in Web3").
- Para documentacion, prioriza fuentes oficiales y conocidas (Ethereum.org, docs de Polygon, MetaMask Learn).

=== JERARQUIA DE VERDAD Y CONTEXTO ===
Para responder, debes seguir este orden de prioridad:
1. **Videos Oficiales**: Lo que se dice en los videos (transcripciones adjuntas abajo) es la fuente primaria de verdad.
2. **GitBook/Documentacion**: La documentacion oficial es la fuente secundaria.
3. **FAQ y Conocimiento General**: Solo si la informacion no esta en las anteriores.

${dynamicContext}

=== VIDEOS DE GUIA DISPONIBLES EN EL HOME ===
La plataforma cuenta con videos oficiales de guia en YouTube. Cuando el usuario pregunte como empezar, donde ver tutoriales o necesite ayuda con algun flujo, mencionalos y da el enlace.

Videos en Espanol:
- "Guia completa de Oddswin": https://youtu.be/8xVqr8F9Fbs
- "Como iniciar en Oddswin": https://youtu.be/eE6VH8GSX0Y
- "Oddswin paso a paso": https://youtu.be/BdNDTeZUuwc
- "Introduccion a TrustPlay": https://youtu.be/PqIiaqHyLhg

Videos en Ingles:
- "How to get started in Oddswin": https://youtu.be/90nPMl_xXPo
- "TrustPlay introduction": https://youtu.be/pLqQXMs0yJA

Todos estos videos estan disponibles directamente en la pagina principal de trustplay.app.

=== GUIA PASO A PASO PARA INICIAR ===
Cuando un usuario pregunte como empezar o como registrarse en TrustPlay/OddsWin, explica estos pasos en orden:

1. Visita trustplay.app
2. Registrate con tu correo electronico o conecta una wallet compatible.
3. Configura MetaMask u otra wallet en la red Polygon (MATIC). Descargala en metamask.io.
4. Obtén USDT en la red Polygon (en exchanges como Binance, Coinbase, etc).
5. Explora las rondas activas de OddsWin y compra tus cajas.
6. Confirma la transaccion desde tu wallet.
7. Revisa tu dashboard para ver resultados, ganancias y recompensas.
8. Invita amigos con tu enlace de referido para ganar comisiones como sponsor.

Para ver el proceso visualmente: https://youtu.be/eE6VH8GSX0Y
O descarga la guia PDF desde la pagina principal de trustplay.app.

=== CONCEPTOS CLAVE ===
- TrustPlay: Plataforma creada por CardenasLABS que alberga OddsWin.
- OddsWin: Juego de rondas donde se compran cajas en USDT para participar en sorteos.
- Cajas: Unidades de participacion. Cada caja tiene un precio en USDT.
- Rondas: Eventos con fecha de cierre. Al cerrar, se distribuyen recompensas.
- USDT: Criptomoneda estable usada en la plataforma, en la red Polygon.
- Polygon (MATIC): Red blockchain rapida y de bajo costo donde opera la plataforma.
- MetaMask: Wallet digital recomendada para interactuar con la plataforma.
- NFT Exclusivo: Da beneficios adicionales en las rondas.
- Founding Circle: Grupo con NFTs fundacionales que recibe parte de las recompensas.
- Sponsor: Ganas comisiones cuando alguien compra cajas con tu enlace de referido.
- Dashboard: Panel donde ves tus cajas, historial, ganancias y comisiones.

=== CONTRATOS OFICIALES VERIFICADOS (POLYGON) ===
Cuando el usuario pregunte por contratos, direcciones o verificacion on-chain de TrustPlay/Oddswin, usa estas direcciones como referencia oficial:
- Factory: 0x47e23cF02317066D2E6593De1D2F1D6C13EF1932
- Middleware: 0x7324Ac4736460DFD3c5646453F4c436bc0975395
- Template: 0x901813Eb398DF81E81244d3f52A66A8b37c226a6
- Sponsors: 0x8F9779aE74D8f70b20deCCf7B44dA252f139E568
- NFT Prime: 0x8ba3CBFB8bC2Ed35F24CDaF954E9e82AdD9012d4
- NFT Founding: 0xeA26D069d7144d86117fc433Ca9d77395e820309

Si piden explorador, entrega el formato de enlace de PolygonScan:
https://polygonscan.com/address/<DIRECCION_CONTRATO>

No inventes contratos adicionales ni reemplaces estas direcciones si el usuario pregunta especificamente por TrustPlay/Oddswin.

=== PREGUNTAS FRECUENTES ===
- Quien creo TrustPlay? CardenasLABS.
- Es gratis registrarse? Si, solo necesitas USDT para participar en rondas.
- En que red trabaja? Polygon (MATIC).
- Que wallet necesito? MetaMask u otra compatible con Polygon.
- Donde consigo USDT? En exchanges como Binance o Coinbase, luego transferirlo a Polygon.
- Hay videos de guia? Si, disponibles en la pagina principal y en YouTube (enlaces arriba).
- Donde veo mis ganancias? En tu dashboard dentro de la plataforma.
`.trim()
        }
    ]
});

const extractGeminiText = (payload) => {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";

    return parts
        .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (errorMsg) => {
    const match = String(errorMsg || "").match(/retry in ([0-9]+(?:\.[0-9]+)?)s/);
    if (!match) return null;
    return Math.ceil(parseFloat(match[1]) * 1000);
};

const callGeminiAPI = async ({ apiKey, model, timeoutMs, maxOutputTokens, message, context }) => {
    const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            systemInstruction: buildSystemInstruction(context),
            contents: [{ role: "user", parts: [{ text: message }] }],
            generationConfig: { temperature: 0.5, topP: 0.9, maxOutputTokens }
        }),
        signal: AbortSignal.timeout(timeoutMs)
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const upstreamMessage = payload?.error?.message || "Gemini no pudo responder.";
        throw new Error(upstreamMessage);
    }

    const reply = extractGeminiText(payload);
    if (!reply) throw new Error("Gemini devolvio una respuesta vacia.");

    return { reply, model };
};

const generateReply = async ({ message }) => {
    const config = resolveGeminiConfig();
    const MAX_RETRY_WAIT_MS = 12000;

    // Load dynamic context based on the question
    let context = "";
    try {
        context = await knowledgeContextService.buildKnowledgeContext(message);
    } catch (err) {
        console.warn("Failed to build knowledge context:", err.message);
    }

    try {
        return await callGeminiAPI({ ...config, message, context });
    } catch (firstError) {
        const retryAfterMs = parseRetryAfterMs(firstError?.message);

        if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_WAIT_MS) {
            console.warn(`trustplayAssistant: rate limit activo, retry en ${retryAfterMs}ms (> max), fallando rapido.`);
            throw firstError;
        }

        const waitMs = retryAfterMs !== null ? retryAfterMs + 200 : 1500;
        console.warn(`trustplayAssistant: primer intento fallido, reintentando en ${waitMs}ms...`, firstError?.message);
        await sleep(waitMs);

        return await callGeminiAPI({ ...config, message, context });
    }
};

module.exports = { generateReply };
