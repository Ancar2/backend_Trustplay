const geminiAssistantService = require("../../services/trustplay/geminiAssistant.service");

const chat = async (req, res) => {
    try {
        const message = String(req.body?.message || "").trim();
        const { reply, model } = await geminiAssistantService.generateReply({ message });

        return res.status(200).json({
            ok: true,
            reply,
            model
        });
    } catch (error) {
        const rawMsg = error?.message || "";
        console.error("trustplayAssistant.chat", rawMsg);

        let userMsg = "No pude responder en este momento. Intenta de nuevo en unos segundos.";

        if (rawMsg.includes("Quota exceeded") || rawMsg.includes("rate limit") || rawMsg.includes("429")) {
            // Extraer segundos del error: "Please retry in 23.890537276s"
            const match = rawMsg.match(/retry in ([0-9]+(?:\.[0-9]+)?)s/);
            if (match) {
                const seconds = Math.ceil(parseFloat(match[1]));
                userMsg = `El asistente está muy solicitado. Por favor, intenta de nuevo en ${seconds} segundos.`;
            } else {
                userMsg = "El asistente alcanzó su límite temporal. Por favor, espera un minuto e intenta de nuevo.";
            }
        } else if (rawMsg.includes("timeout") || rawMsg.includes("tardó demasiado")) {
            userMsg = "La respuesta está tardando más de lo habitual. Por favor, intenta de nuevo.";
        }

        return res.status(error?.status || 500).json({
            ok: false,
            msg: userMsg,
            code: "trustplay_assistant_error"
        });
    }
};



module.exports = {
    chat
};
