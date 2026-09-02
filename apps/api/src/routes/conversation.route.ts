import { Router } from "express";
import { conversationController } from "../controllers/conversation.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";

const conversationRouter: Router = Router();

conversationRouter.get(
  "/",
  authMiddleware,
  conversationController.getConversations,
);
conversationRouter.post(
  "/",
  authMiddleware,
  conversationController.createConversation,
);
conversationRouter.post(
  "/:conversationId/messages",
  authMiddleware,
  conversationController.createMessage,
);
conversationRouter.post(
  "/:conversationId/checkout-authorize",
  authMiddleware,
  conversationController.checkoutAuthorize,
);
conversationRouter.get(
  "/:conversationId/messages",
  authMiddleware,
  conversationController.getConversationHistory,
);

export default conversationRouter;
