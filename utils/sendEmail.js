const nodemailer = require("nodemailer");

const resolveSmtpUser = () => String(process.env.SMTP_EMAIL || "").trim();

const isGmailAddress = (value) => /@gmail\.com$/i.test(String(value || "").trim());

const resolveSmtpHost = () => {
    const configuredHost = String(process.env.SMTP_HOST || "").trim();
    if (configuredHost) return configuredHost;

    if (isGmailAddress(resolveSmtpUser())) return "smtp.gmail.com";

    return "smtp-relay.sendinblue.com";
};

const resolveSmtpPort = () => {
    const configuredPort = Number(process.env.SMTP_PORT || 0);
    if (Number.isFinite(configuredPort) && configuredPort > 0) return configuredPort;

    if (isGmailAddress(resolveSmtpUser())) return 465;

    return 587;
};

const resolveFromEmail = () => {
    const explicitFromEmail = String(process.env.FROM_EMAIL || "").trim();
    if (explicitFromEmail) return explicitFromEmail;

    const smtpEmail = resolveSmtpUser();
    if (smtpEmail) return smtpEmail;

    return "no-reply@trustplay.app";
};

const resolveSmtpPassword = () => {
    const rawPassword = String(process.env.SMTP_PASSWORD || "");
    if (isGmailAddress(resolveSmtpUser())) {
        return rawPassword.replace(/\s+/g, "");
    }

    return rawPassword.trim();
};

const sendEmail = async (options) => {
    const smtpUser = resolveSmtpUser();
    const smtpHost = resolveSmtpHost();
    const smtpPort = resolveSmtpPort();
    const useSecureTransport = smtpPort === 465;

    const transporter = nodemailer.createTransport({
        service: isGmailAddress(smtpUser) && !String(process.env.SMTP_HOST || "").trim() ? "gmail" : undefined,
        host: smtpHost,
        port: smtpPort,
        secure: useSecureTransport,
        auth: {
            user: smtpUser,
            pass: resolveSmtpPassword(),
        },
    });

    const fromEmail = resolveFromEmail();
    const fromName = String(process.env.FROM_NAME || "Trustplay Support").trim() || "Trustplay Support";

    const message = {
        from: `${fromName} <${fromEmail}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html,
    };

    try {
        await transporter.sendMail(message);
    } catch (error) {
        console.error("Error enviando correo SMTP:", {
            message: error?.message || "SMTP_SEND_FAILED",
            response: error?.response || "",
            responseCode: error?.responseCode || null,
            command: error?.command || "",
            smtpUser,
            smtpHost,
            smtpPort,
            secure: useSecureTransport,
            fromEmail,
            to: options.email,
            subject: options.subject,
        });
        throw error;
    }
};

module.exports = sendEmail;
