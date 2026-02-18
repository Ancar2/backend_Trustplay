const User = require("../models/user.model");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { buildVerificationEmail } = require("../utils/emailTemplates");
const {
  ensureNewUserLegalAcceptance,
  registerCurrentLegalAcceptanceForNewUser
} = require("../services/legal/legal.service");

const EMAIL_VERIFY_TTL_MINUTES = Number(process.env.EMAIL_VERIFY_TTL_MINUTES || 60 * 24);

const hashVerificationToken = (token) => (
  crypto.createHash("sha256").update(String(token)).digest("hex")
);

const PHONE_COUNTRY_CODE_REGEX = /^\+[1-9]\d{0,3}$/;
const PHONE_NATIONAL_REGEX = /^\d{6,15}$/;

const normalizePhoneCountryCode = (value) => (
  typeof value === "string" ? value.trim() : ""
);

const normalizePhoneNationalNumber = (value) => (
  typeof value === "string" ? value.replace(/\D+/g, "") : ""
);

const resolveVerificationTtlMinutes = () => (
  Number.isFinite(EMAIL_VERIFY_TTL_MINUTES) && EMAIL_VERIFY_TTL_MINUTES > 0
    ? EMAIL_VERIFY_TTL_MINUTES
    : (60 * 24)
);

const generateVerificationTokenData = () => {
  const token = crypto.randomBytes(32).toString("hex");
  const ttlMinutes = resolveVerificationTtlMinutes();

  return {
    token,
    hash: hashVerificationToken(token),
    expireAt: new Date(Date.now() + ttlMinutes * 60 * 1000)
  };
};

const sendVerificationEmail = async (email, token, username) => {
  const frontendUrl = String(process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
  const verifyUrl = `${frontendUrl}/verify-email/${token}`;
  const template = buildVerificationEmail({
    verifyUrl,
    username,
    ttlMinutes: resolveVerificationTtlMinutes()
  });

  await sendEmail({
    email,
    subject: template.subject,
    html: template.html,
    message: template.text
  });
};

exports.register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      phone,
      marketingConsent,
      sponsor,
      photo,
      legalAcceptance
    } = req.body;

    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhoneCountryCode = normalizePhoneCountryCode(phone?.countryCode);
    const normalizedPhoneNationalNumber = normalizePhoneNationalNumber(phone?.nationalNumber);
    const normalizedPhoneE164 = `${normalizedPhoneCountryCode}${normalizedPhoneNationalNumber}`;

    // 1. Input Validation
    if (!normalizedUsername || !normalizedEmail || !password || !normalizedPhoneCountryCode || !normalizedPhoneNationalNumber) {
      return res.status(400).json({ msj: "Faltan campos obligatorios (username, email, celular, password)" });
    }

    if (!PHONE_COUNTRY_CODE_REGEX.test(normalizedPhoneCountryCode)) {
      return res.status(400).json({ msj: "El indicativo del celular no es válido." });
    }

    if (!PHONE_NATIONAL_REGEX.test(normalizedPhoneNationalNumber)) {
      return res.status(400).json({ msj: "El número de celular no es válido." });
    }

    const legalValidation = await ensureNewUserLegalAcceptance({
      legalAcceptancePayload: legalAcceptance
    });
    if (!legalValidation.ok) {
      const pendingDocuments = Array.isArray(legalValidation.pendingDocuments)
        ? legalValidation.pendingDocuments
        : [];
      return res.status(400).json({
        msj: legalValidation.msg,
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        legalVersion: pendingDocuments[0]?.version || "",
        pendingDocuments
      });
    }

    const marketingAccepted = marketingConsent?.accepted === true || legalAcceptance?.accepted === true;

    // Validar robustez de la contraseña
    // Min 6 caracteres, 1 mayúscula, 1 minúscula, 1 especial o número
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d|.*[\W_]).{6,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        msj: "La contraseña es muy débil. Debe tener al menos 6 caracteres, una mayúscula, una minúscula y un número o caracter especial."
      });
    }

    // Verificar si el usuario ya existe en Trustplay
    const userExists = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }]
    });
    if (userExists) {
      return res.status(409).json({ msj: "Usuario o correo ya existe" });
    }

    const verificationData = generateVerificationTokenData();

    const user = new User({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      role: "user",
      phone: {
        countryCode: normalizedPhoneCountryCode,
        nationalNumber: normalizedPhoneNationalNumber,
        e164: normalizedPhoneE164
      },
      sponsor: typeof sponsor === "string" ? sponsor.toLowerCase() : null,
      photo,
      isVerified: false, // Default
      verificationTokenHash: verificationData.hash,
      verificationTokenExpire: verificationData.expireAt,
      marketingConsent: {
        accepted: marketingAccepted,
        acceptedAt: new Date(),
        source: "register_form"
      }
    });

    await user.save();
    await registerCurrentLegalAcceptanceForNewUser({
      userId: user._id,
      req,
      source: "register_form"
    });

    try {
      await sendVerificationEmail(user.email, verificationData.token, user.username);

      res.status(201).json({
        success: true,
        message: "Registro exitoso. Se ha enviado un correo de verificación.",
        // No devolvemos token para evitar login automático
      });
    } catch (error) {
      console.error("Error enviando email de verificación:", error);
      // Podríamos borrar el usuario si falla el email, o dejarlo inactivo.
      // Por ahora lo dejamos, el usuario puede intentar reenviar verificación (feature futura)
      res.status(500).json({ msj: "Usuario registrado pero falló el envío del correo de verificación." });
    }

  } catch (error) {
    console.error("Error en registro:", error);
    res.status(500).json({ msj: "Error interno del servidor al registrar usuario" });
  }
};

exports.resendVerificationEmail = async (req, res) => {
  try {
    const normalizedEmail = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

    if (!normalizedEmail) {
      return res.status(400).json({ msj: "email es requerido" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(200).json({
        success: true,
        msj: "Si el correo pertenece a una cuenta pendiente, se enviara un nuevo enlace de verificación."
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        msj: "La cuenta ya se encuentra verificada. Puedes iniciar sesión."
      });
    }

    const verificationData = generateVerificationTokenData();
    user.verificationToken = undefined;
    user.verificationTokenHash = verificationData.hash;
    user.verificationTokenExpire = verificationData.expireAt;
    await user.save();

    await sendVerificationEmail(user.email, verificationData.token, user.username);

    return res.status(200).json({
      success: true,
      msj: "Se envío un nuevo enlace de verificación. Revisa tu correo."
    });
  } catch (error) {
    console.error("Error reenviando verificación de correo:", error);
    return res.status(500).json({ msj: "Error interno reenviando verificación de correo." });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ msj: "Token de verificación inválido" });
    }

    const tokenHash = hashVerificationToken(token);
    const now = new Date();

    // 1) Secure path: hashed token + expiration.
    let user = await User.findOne({
      verificationTokenHash: tokenHash,
      verificationTokenExpire: { $gt: now }
    });

    // 2) Backward compatibility: legacy plain token links already issued.
    if (!user) {
      user = await User.findOne({ verificationToken: token });
    }

    if (!user) {
      return res.status(400).json({ msj: "Token de verificación inválido o expirado" });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenHash = undefined;
    user.verificationTokenExpire = undefined;
    await user.save();

    res.status(200).json({ msj: "Correo verificado exitosamente. Ahora puedes iniciar sesión." });

  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({ msj: "Error interno verificando correo" });
  }
};
