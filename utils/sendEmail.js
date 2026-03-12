const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
    const transporter = nodemailer.createTransport({
        // service: "gmail", // O usa host/port si tienes otro SMTP
        // host: "smtp.gmail.com",
        // port: 587,
        host: "smtp-relay.brevo.com",
        port: 587,
        // host: "email-smtp.us-east-2.amazonaws.com",
        // port: 587,
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    const message = {
        from: `${process.env.FROM_NAME || 'Trustplay Support'} <no-reply@trustplay.app>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html, // Opcional si quieres enviar HTML
    };

    await transporter.sendMail(message);
};

module.exports = sendEmail;
