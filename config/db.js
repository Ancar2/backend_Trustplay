const mongoose = require("mongoose");

const connectionDB = async () => {
    try {
        await mongoose.connect(process.env.DB_URL);
        console.log("CONECTADO A LA BASE DE DATOS");
        return mongoose.connection;
    } catch (error) {
        console.log("CONEXION FALLIDA", error.message);
        throw error;
    }
};

module.exports = connectionDB;
