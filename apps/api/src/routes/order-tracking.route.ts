import { Router } from "express";
import { orderTrackingController } from "../controllers/order-tracking.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const orderTrackingRouter: Router = Router();

orderTrackingRouter.get(
  "/conversations/:conversationId",
  authMiddleware,
  orderTrackingController.listConversationOrders,
);
orderTrackingRouter.get(
  "/:orderId/track/stream",
  authMiddleware,
  orderTrackingController.trackOrderStream,
);

export default orderTrackingRouter;