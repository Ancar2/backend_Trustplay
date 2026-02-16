const User = require("../models/user.model");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { buildVerificationEmail } = require("../utils/emailTemplates");
const {
  getCurrentLegalVersion,
  validateLegalAcceptance,
  buildLegalAcceptanceRecord,
  registerLegalAcceptanceAudit
} = require("../utils/legalAcceptance");

const EMAIL_VERIFY_TTL_MINUTES = Number(process.env.EMAIL_VERIFY_TTL_MINUTES || 60 * 24);

const hashVerificationToken = (token) => (
  crypto.createHash("sha256").update(String(token)).digest("hex")
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
      sponsor,
      photo,
      legalAcceptance
    } = req.body;

    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    // 1. Input Validation
    if (!normalizedUsername || !normalizedEmail || !password) {
      return res.status(400).json({ msj: "Faltan campos obligatorios (username, email, password)" });
    }

    const currentLegalVersion = await getCurrentLegalVersion();
    const legalValidation = validateLegalAcceptance(legalAcceptance, currentLegalVersion);
    if (!legalValidation.ok) {
      return res.status(400).json({
        msj: legalValidation.msg,
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        legalVersion: currentLegalVersion
      });
    }

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
      sponsor: typeof sponsor === "string" ? sponsor.toLowerCase() : null,
      photo,
      isVerified: false, // Default
      verificationTokenHash: verificationData.hash,
      verificationTokenExpire: verificationData.expireAt,
      legalAcceptance: buildLegalAcceptanceRecord({
        normalized: legalValidation.normalized,
        source: "register_form",
        req
      })
    });

    await user.save();
    await registerLegalAcceptanceAudit({
      user,
      legalAcceptance: user.legalAcceptance
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
