const express = require("express");
const trustplayRoutes = require("./modules/trustplay.routes");
const authRoutes = require("./modules/auth.routes");
const usersRoutes = require("./modules/users.routes");
const oddswinAdminRoutes = require("./modules/oddswin/admin.routes");
const oddswinConfigRoutes = require("./modules/oddswin/config.routes");
const oddswinRoutes = require("./modules/oddswin/oddswin.routes");

const apiRouter = express.Router();

// Legacy API (current frontend compatibility)
apiRouter.use(trustplayRoutes);
apiRouter.use(authRoutes);
apiRouter.use(usersRoutes);
apiRouter.use(oddswinAdminRoutes);
apiRouter.use(oddswinConfigRoutes);
apiRouter.use(oddswinRoutes);

// New game-oriented namespace for future integrations.
apiRouter.use("/games/oddswin", oddswinConfigRoutes);
apiRouter.use("/games/oddswin", oddswinRoutes);

module.exports = apiRouter;
