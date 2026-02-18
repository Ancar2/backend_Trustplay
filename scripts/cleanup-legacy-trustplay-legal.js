require('dotenv').config();

const mongoose = require('mongoose');
const connectionDB = require('../config/db');
const TrustplayInfo = require('../models/trustplay/trustplayInfo.model');

const run = async () => {
    try {
        await connectionDB();

        const result = await TrustplayInfo.updateMany(
            {},
            {
                $unset: {
                    legalVersion: 1,
                    legalUpdatedAt: 1,
                    legal: 1,
                    legalVersions: 1
                }
            },
            { strict: false }
        );

        console.log('Cleanup legacy legal fields (trustplay_info) completado.');
        console.log(`Documentos coincidentes: ${result.matchedCount || 0}`);
        console.log(`Documentos modificados: ${result.modifiedCount || 0}`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error limpiando legacy legal en trustplay_info:', error.message);
        await mongoose.connection.close().catch(() => undefined);
        process.exit(1);
    }
};

run();
