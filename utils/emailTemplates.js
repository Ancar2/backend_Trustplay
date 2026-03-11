const DEFAULT_FRONTEND_URL = "http://localhost:4200";

const normalizeBaseUrl = (value) => String(value || "").replace(/\/+$/, "");

const resolveFrontendUrl = () => {
    const configured = normalizeBaseUrl(process.env.FRONTEND_URL);
    return configured || DEFAULT_FRONTEND_URL;
};

const resolveLogoUrl = () => {
    const explicit = String(process.env.EMAIL_LOGO_URL || "").trim();
    if (explicit) {
        return explicit;
    }
    return `${resolveFrontendUrl()}/assets/brand/logo-trustplay.png`;
};

const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMinutesLabel = (rawMinutes) => {
    const minutes = Number(rawMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return "";
    }
    if (minutes % 1440 === 0) {
        const days = minutes / 1440;
        return `${days} dia${days === 1 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `${hours} hora${hours === 1 ? "" : "s"}`;
    }
    return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
};

const buildLayout = ({
    preheader,
    kicker,
    title,
    introHtml,
    ctaLabel,
    ctaUrl,
    afterCtaHtml,
    securityHtml
}) => {
    const safePreheader = escapeHtml(preheader);
    const safeKicker = escapeHtml(kicker);
    const safeTitle = escapeHtml(title);
    const safeCtaLabel = escapeHtml(ctaLabel);
    const safeCtaUrl = escapeHtml(ctaUrl);
    const logoUrl = escapeHtml(resolveLogoUrl());
    const supportEmail = escapeHtml(process.env.SMTP_EMAIL || "soporte@trustplay.com");
    const currentYear = new Date().getFullYear();

    return `
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#050814;color:#e9f0ff;">
    <div style="display:none;opacity:0;max-height:0;overflow:hidden;line-height:1px;font-size:1px;">
        ${safePreheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050814;">
        <tr>
            <td align="center" style="padding:22px 12px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;border-collapse:separate;border-spacing:0;background:#0d1220;border:1px solid #1f2b45;border-radius:16px;overflow:hidden;">
                    <tr>
                        <td style="padding:28px 28px 18px;text-align:center;background:linear-gradient(140deg,#0f1d35 0%,#11192b 100%);">
                            <img src="${logoUrl}" alt="Trustplay" width="170" style="display:block;margin:0 auto 18px;max-width:170px;height:auto;" />
                            <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#68f4ff;">${safeKicker}</p>
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                                <tr>
                                    <td style="padding:10px 16px;border-radius:12px;background:#c7f8ff;border:1px solid #82ecff;">
                                        <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.2;color:#04121d !important;">${safeTitle}</h1>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:26px 28px 28px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#d6e0f6;">
                                ${introHtml}
                            </div>
                            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 18px;">
                                <tr>
                                    <td align="center" bgcolor="#10d7f5" style="border-radius:10px;">
                                        <a href="${safeCtaUrl}" clicktracking=off style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#04121d;text-decoration:none;">
                                            ${safeCtaLabel}
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#9eb0d2;word-break:break-all;">
                                Si el boton no funciona, copia este enlace en tu navegador:
                                <br />
                                <a href="${safeCtaUrl}" clicktracking=off style="color:#82f6ff;text-decoration:underline;">${safeCtaUrl}</a>
                            </p>
                            <div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#d6e0f6;">
                                ${afterCtaHtml}
                            </div>
                            <div style="margin-top:18px;padding:12px 14px;border-radius:10px;border:1px solid #2d3a58;background:#121a2e;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#a9b9d8;">
                                ${securityHtml}
                            </div>
                        </td>
                    </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin-top:14px;">
                    <tr>
                        <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#7f91b5;text-align:center;padding:0 8px;">
                            Trustplay ${currentYear} - Este correo fue generado automaticamente por una accion de seguridad de tu cuenta.
                            <br />
                            Soporte: <a href="mailto:${supportEmail}" style="color:#91e8ff;text-decoration:none;">${supportEmail}</a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

const buildVerificationEmail = ({ verifyUrl, username, ttlMinutes }) => {
    const safeName = username ? `<p style="margin:0 0 10px;"><strong>Hola ${escapeHtml(username)}</strong>,</p>` : "";
    const ttlLabel = formatMinutesLabel(ttlMinutes);
    const ttlText = ttlLabel ? `El enlace estara disponible durante ${ttlLabel}.` : "El enlace tiene una vigencia limitada por seguridad.";

    const html = buildLayout({
        preheader: "Confirma tu correo para activar tu cuenta Trustplay.",
        kicker: "Verificacion de cuenta",
        title: "Confirma tu correo electronico",
        introHtml: `
            ${safeName}
            <p style="margin:0 0 12px;">Gracias por registrarte en Trustplay. Necesitamos verificar tu correo para activar tu cuenta.</p>
            <p style="margin:0;">${escapeHtml(ttlText)}</p>
        `,
        ctaLabel: "Verificar correo",
        ctaUrl: verifyUrl,
        afterCtaHtml: `
            <p style="margin:0;">Despues de verificar, podras iniciar sesion y usar todas las funciones de la plataforma.</p>
        `,
        securityHtml: "Si no creaste esta cuenta, puedes ignorar este mensaje."
    });

    const text = [
        "Trustplay - Verificacion de correo",
        "",
        username ? `Hola ${username},` : "Hola,",
        "Gracias por registrarte en Trustplay.",
        "Confirma tu correo con este enlace:",
        verifyUrl,
        ttlText,
        "",
        "Si no creaste esta cuenta, ignora este correo."
    ].join("\n");

    return {
        subject: "Verificacion de Correo - Trustplay",
        html,
        text
    };
};

const buildPasswordResetEmail = ({ resetUrl, username, expiresInMinutes }) => {
    const safeName = username ? `<p style="margin:0 0 10px;"><strong>Hola ${escapeHtml(username)}</strong>,</p>` : "";
    const ttlLabel = formatMinutesLabel(expiresInMinutes);
    const ttlText = ttlLabel
        ? `Este enlace caduca en ${ttlLabel}.`
        : "Este enlace caduca pronto por seguridad.";

    const html = buildLayout({
        preheader: "Solicitud de restablecimiento de contrasena en Trustplay.",
        kicker: "Recuperacion de acceso",
        title: "Restablece tu contrasena",
        introHtml: `
            ${safeName}
            <p style="margin:0 0 12px;">Recibimos una solicitud para cambiar la contrasena de tu cuenta Trustplay.</p>
            <p style="margin:0;">${escapeHtml(ttlText)}</p>
        `,
        ctaLabel: "Cambiar contrasena",
        ctaUrl: resetUrl,
        afterCtaHtml: `
            <p style="margin:0;">Si no solicitaste este cambio, no hagas clic y desestima este correo.</p>
        `,
        securityHtml: "Por seguridad, nunca compartas este enlace ni tu contrasena con terceros."
    });

    const text = [
        "Trustplay - Restablecer contrasena",
        "",
        username ? `Hola ${username},` : "Hola,",
        "Recibimos una solicitud para cambiar tu contrasena.",
        "Usa este enlace para continuar:",
        resetUrl,
        ttlText,
        "",
        "Si no solicitaste este cambio, ignora este correo."
    ].join("\n");

    return {
        subject: "Restablecer Contrasena - Trustplay",
        html,
        text
    };
};

module.exports = {
    buildVerificationEmail,
    buildPasswordResetEmail
};
