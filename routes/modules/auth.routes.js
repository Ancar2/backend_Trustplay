const express = require("express");
const rateLimit = require("express-rate-limit");
const registerController = require("../../controllers/register.controller");
const loginController = require("../../controllers/login.controller");
const userController = require("../../controllers/user.controller");
const { validateRequest, validators } = require("../../middleware/requestValidation");

const router = express.Router();

const resolveClientIp = (req) => {
    const cloudflareIp = String(req.header("cf-connecting-ip") || "").trim();
    if (cloudflareIp) return cloudflareIp;

    const forwardedFor = String(req.header("x-forwarded-for") || "");
    const firstForwardedIp = forwardedFor
        .split(",")
        .map((item) => item.trim())
        .find(Boolean);
    if (firstForwardedIp) return firstForwardedIp;

    return String(req.ip || req.socket?.remoteAddress || "unknown");
};

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 50),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => resolveClientIp(req),
    skipSuccessfulRequests: true,
    message: { msj: "Demasiados intentos de autenticacion. Intenta nuevamente en unos minutos." }
});

router.post(
    "/users/register",
    authLimiter,
    validateRequest(validators.registerBody),
    registerController.register
);
router.get("/users/verify/:token", registerController.verifyEmail);
router.post(
    "/users/resend-verification",
    authLimiter,
    validateRequest(validators.resendVerificationBody),
    registerController.resendVerificationEmail
);

router.post(
    "/users/login",
    authLimiter,
    validateRequest(validators.loginBody),
    loginController.login
);
router.post(
    "/users/login/social",
    authLimiter,
    validateRequest(validators.socialLoginBody),
    loginController.socialLogin
);
router.post(
    "/users/login/social/complete",
    authLimiter,
    validateRequest(validators.completeSocialLoginBody),
    loginController.completeSocialLogin
);
router.post("/users/logout", loginController.logout);

router.post(
    "/users/forgot-password",
    authLimiter,
    validateRequest(validators.forgotPasswordBody),
    userController.forgotPassword
);
router.put(
    "/users/reset-password/:resetToken",
    authLimiter,
    validateRequest(validators.resetPasswordBody),
    userController.resetPassword
);

module.exports = router;
