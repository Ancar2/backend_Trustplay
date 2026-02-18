require("dotenv").config();

const connectionDB = require("../config/db");
const { seedLegalDocuments } = require("../services/legal/legal.service");

const run = async () => {
    try {
        await connectionDB();
        await seedLegalDocuments({ force: false });
        console.log("Seed legal completado: terms/privacy/cookies/disclaimer con versiones 1.0.0 y 1.1.0.");
        process.exit(0);
    } catch (error) {
        console.error("Error ejecutando seed legal:", error.message);
        process.exit(1);
    }
};

run();
