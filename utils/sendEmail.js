const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
    const transporter = nodemailer.createTransport({
        service: "gmail", // O usa host/port si tienes otro SMTP
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    const message = {
        from: `${process.env.FROM_NAME || 'Trustplay Support'} <${process.env.SMTP_EMAIL}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html, // Opcional si quieres enviar HTML
    };

    await transporter.sendMail(message);
};

module.exports = sendEmail;
