const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      // Password not required for social login users
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    // Providers for social login
    providers: [{
      name: {
        type: String,
        enum: ['google', 'facebook', 'instagram'],
        required: true
      },
      id: {
        type: String,
        required: true
      }
    }],
    // Wallets vinculadas (solo direcciones)
    wallets: [
      {
        type: String,
        lowercase: true,
      },
    ],
    // Sponsor (dirección de wallet del sponsor)
    sponsor: {
      type: String,
      lowercase: true,
      default: null,
    },
    // Nuevas "personalidades": Lista de sponsors por cada wallet específica
    sponsorships: [{
      wallet: { type: String, lowercase: true },
      sponsor: { type: String, lowercase: true }
    }],
    isLoggedIn: {
      type: Boolean,
      default: false,
    },
    photo: {
      type: String,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    // Legacy plain token kept for backward compatibility with already-issued links.
    verificationToken: String,
    // New secure email verification fields.
    verificationTokenHash: String,
    verificationTokenExpire: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    legalAcceptance: {
      accepted: { type: Boolean, default: false },
      version: { type: String, default: "" },
      acknowledgements: {
        terms: { type: Boolean, default: false },
        privacy: { type: Boolean, default: false },
        cookies: { type: Boolean, default: false },
        disclaimer: { type: Boolean, default: false }
      },
      acceptedAt: { type: Date, default: null },
      ipAddress: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      source: {
        type: String,
        enum: ["register_form", "social_login", "login_form"],
        default: "register_form"
      }
    }
  },
  {
    timestamps: true,
  }
);

// Encriptar contraseña antes de guardar
userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Método para comparar contraseñas
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.index({ wallets: 1 });
userSchema.index({ "sponsorships.wallet": 1 });
userSchema.index({ verificationTokenHash: 1 }, { sparse: true });

module.exports = mongoose.model("User", userSchema);
