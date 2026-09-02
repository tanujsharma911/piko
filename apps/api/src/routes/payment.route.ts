import { Router } from "express";
import { paymentController } from "../controllers/payment.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const paymentRouter: Router = Router();

paymentRouter.post("/verify", authMiddleware, paymentController.verifyPayment);
paymentRouter.post("/webhook", paymentController.paymentWebhook);
paymentRouter.get(
  "/conversation/:conversationId",
  authMiddleware,
  paymentController.getPaymentState,
);

export default paymentRouter;