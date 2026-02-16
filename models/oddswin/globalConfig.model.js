const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalConfigSchema = new Schema({
    sponsors: { type: String, default: '' },
    middleware: { type: String, default: '' },
    factory: { type: String, default: '' },
    exclusiveNFT: { type: String, default: '' },
    usdt: { type: String, default: '' },
    owner: { type: String, default: '' }, // Owner Address (Factory Owner)
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GlobalConfig', globalConfigSchema);
