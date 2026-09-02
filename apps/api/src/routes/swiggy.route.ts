import { Router } from "express";
import { swiggyController } from "../controllers/swiggy.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const swiggyRouter: Router = Router();

swiggyRouter.get("/connect", authMiddleware, swiggyController.connect);
swiggyRouter.get("/callback", swiggyController.callback);
swiggyRouter.get("/status", authMiddleware, swiggyController.status);
swiggyRouter.post("/disconnect", authMiddleware, swiggyController.disconnect);

export default swiggyRouter;
