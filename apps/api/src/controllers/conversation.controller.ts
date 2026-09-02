import type { Request, Response } from "express";
import type { IAuditEvent } from "db";
import { conversationService } from "../services/conversation.service.js";
import { chat, generateTitle } from "../agent/agent.js";
import { setSSEHeaders, sendSSEEvent, sendSSEError } from "../agent/sse.js";
import { checkSwiggyConnection } from "../agent/swiggy/connection.js";
import { authorizeCheckout } from "../commerce/checkout.service.js";

interface AuthRequest extends Request {
  user?: { id: string; email: string; name: string };
}

export const conversationController = {
  createConversation: async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const { title } = req.body;
      const conversation = await conversationService.createConversation(
        userId,
        title,
      );

      res.status(201).json({ conversation });
    } catch (error) {
      console.log("Error in createConversation:", error);
      res.status(500).json({
        success: false,
        message: "Could not create conversation",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  getConversations: async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const conversations =
        await conversationService.getConversationsByUser(userId);

      res.status(200).json({ conversations });
    } catch (error) {
      console.log("Error in getConversations:", error);
      res.status(500).json({
        success: false,
        message: "Could not load your conversations",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  createMessage: async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    const { conversationId } = req.params;
    const { role, content, model } = req.body as {
      role?: string;
      content?: string;
      model?: string;
    };

    if (!conversationId || !role || !content) {
      res.status(400).json({
        message: "conversationId, role and content are required",
      });
      return;
    }
    if (typeof conversationId !== "string") {
      res.status(400).json({
        message: "conversationId must be a string",
      });
      return;
    }

    const conversation = await conversationService.getConversationById(
      conversationId,
      userId,
    );
    if (!conversation) {
      res.status(404).json({ message: "Conversation not found" });
      return;
    }

    setSSEHeaders(res);

    let responseText = "";
    const auditEvents: IAuditEvent[] = [];

    const AUDIT_PAYLOAD_KEYS = [
      "kind",
      "reason",
      "orderId",
      "via",
      "amount",
      "source",
      "name",
      "note",
      "expected",
      "actual",
      "action",
      "response",
    ];

    try {
      const response = await chat(
        content,
        conversation.messages,
        userId,
        conversationId,
        (event) => {
          sendSSEEvent(res, event);
          if (event.type === "token" && event.text) {
            responseText += event.text;
          }
          if (event.type === "action") {
            const entry: IAuditEvent = {
              message: event.message || "",
              ...(event.toolName ? { toolName: event.toolName } : {}),
              ...(event.status ? { status: event.status } : {}),
            };
            for (const key of AUDIT_PAYLOAD_KEYS) {
              const value = (event as any)[key];
              if (value !== undefined) (entry as any)[key] = value;
            }
            auditEvents.push(entry);
          }
        },
        model,
      );

      responseText = response;

      const finalAuditEvents = auditEvents.map((e) =>
        e.status === "pending" ? { ...e, status: "done" as const } : e,
      );

      if (conversation.title === "New Conversation") {
        const title = await generateTitle(content);
        await conversationService.updateTitle(conversationId, title);
        sendSSEEvent(res, { type: "action", message: `Title: ${title}` });
        finalAuditEvents.push({ message: `Title: ${title}` });
      }

      const messages = [
        {
          content: content,
          role: "user" as "user",
          auditEvents: [],
          createdAt: new Date(),
        },
        {
          content: responseText,
          role: "assistant" as "assistant",
          auditEvents: finalAuditEvents,
          createdAt: new Date(),
        },
      ];

      await conversationService.addMessage(conversationId, messages);

      sendSSEEvent(res, {
        type: "done",
        data: {
          conversationId,
          messages: messages.filter((m) => m.role === "assistant"),
        },
      });
      res.end();
    } catch (error) {
      console.log("Error in createMessage:", error);

      const failureAuditEvents = auditEvents.map((e) =>
        e.status === "pending" ? { ...e, status: "done" as const } : e,
      );
      failureAuditEvents.push({
        message:
          error instanceof Error ? error.message : "Internal server error",
        status: "error",
      });

      const savedMessages: Array<{
        content: string;
        role: "user" | "assistant";
        auditEvents: IAuditEvent[];
        createdAt: Date;
      }> = [
        {
          content: content,
          role: "user",
          auditEvents: [],
          createdAt: new Date(),
        },
        {
          content: responseText || "",
          role: "assistant",
          auditEvents: failureAuditEvents,
          createdAt: new Date(),
        },
      ];

      try {
        await conversationService.addMessage(conversationId, savedMessages);
      } catch (saveErr) {
        console.log("Failed to save partial messages:", saveErr);
      }

      sendSSEError(
        res,
        error instanceof Error ? error.message : "Internal server error",
      );
      sendSSEEvent(res, {
        type: "done",
        data: {
          conversationId,
          messages: savedMessages.filter((m) => m.role === "assistant"),
        },
      });
      res.end();
    }
  },

  checkoutAuthorize: async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const { conversationId } = req.params;
      const { paymentMethod } = req.body as { paymentMethod?: string };

      const conversation = await conversationService.getConversationById(
        conversationId as string,
        userId,
      );
      if (!conversation) {
        res.status(404).json({ message: "Conversation not found" });
        return;
      }

      const { isSwiggyConnected, swiggyAccessToken } =
        await checkSwiggyConnection(userId);

      if (!isSwiggyConnected || !swiggyAccessToken) {
        res.status(400).json({ message: "Swiggy account is not connected" });
        return;
      }

      const result = await authorizeCheckout(
        { userId, conversationId: conversationId as string, swiggyAccessToken },
        paymentMethod,
      );

      if (!result.success || !result.authorization) {
        res.status(400).json({
          success: false,
          message: result.error || "Checkout authorization failed",
        });
        return;
      }

      res.status(201).json({
        success: true,
        authorizationId: result.authorization._id.toString(),
        cartSnapshot: result.cartSnapshot,
        amount: result.authorization.amount,
        cartId: result.authorization.cartId,
        cartHash: result.authorization.cartHash,
        addressId: result.authorization.addressId,
        paymentMethod: result.authorization.paymentMethod,
        expiresAt: result.authorization.expiresAt,
      });
    } catch (error) {
      console.log("Error in checkoutAuthorize:", error);
      const message =
        error instanceof Error && error.name === "MongoServerError"
          ? "Could not authorize checkout. Please try again."
          : "Could not authorize checkout";
      res.status(500).json({
        success: false,
        message,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  getConversationHistory: async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const { conversationId } = req.params;

      const conversation = await conversationService.getConversationById(
        conversationId as string,
        userId,
      );

      res.status(200).json({ messages: conversation?.messages || [] });
    } catch (error) {
      console.log("Error in getConversationHistory:", error);
      res.status(500).json({
        success: false,
        message: "Could not load conversation history",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
