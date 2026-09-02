import type { Request, Response } from "express";
import { Payment } from "db";
import { paymentService } from "../services/payment.service.js";
import { conversationService } from "../services/conversation.service.js";

interface PaymentWebhookBody {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
      };
    };
  };
}

export const paymentController = {
  verifyPayment: async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const { orderId, razorpayPaymentId, signature } = req.body as {
        orderId?: string;
        razorpayPaymentId?: string;
        signature?: string;
      };

      if (!orderId || !razorpayPaymentId || !signature) {
        res.status(400).json({ error: "orderId, razorpayPaymentId and signature are required" });
        return;
      }

      const payment = await paymentService.findByOrderId(orderId);
      if (!payment) {
        res.status(404).json({ error: "Payment order not found" });
        return;
      }

      if (payment.userId.toString() !== userId) {
        res.status(403).json({ error: "Not your payment" });
        return;
      }

      if (payment.status === "paid") {
        res.status(409).json({ error: "Payment already verified" });
        return;
      }

      if (!paymentService.verifySignature(orderId, razorpayPaymentId, signature)) {
        res.status(400).json({ error: "Invalid signature" });
        return;
      }

      const updated = await paymentService.markPaid(payment, {
        razorpayPaymentId,
        via: "client",
      });

      try {
        await conversationService.appendAuditEvents(
          updated.conversationId.toString(),
          [
            {
              message: "Payment confirmed (via client)",
              status: "done",
              kind: "payment_verified",
              orderId,
              via: "client",
            },
          ],
        );
      } catch (auditErr) {
        console.log("Failed to append payment_verified audit:", auditErr);
      }

      res.status(200).json({
        message: "Payment verified",
        payment: {
          orderId: updated.orderId,
          razorpayPaymentId: updated.razorpayPaymentId,
          amount: updated.amount,
        },
      });
    } catch (error) {
      console.log("Error verifying payment:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  paymentWebhook: async (req: Request, res: Response) => {
    try {
      const rawBody = req.rawBody || JSON.stringify(req.body);
      const signatureHeader = req.headers["x-razorpay-signature"];

      if (!signatureHeader) {
        res.status(400).json({ error: "Missing signature" });
        return;
      }

      if (!paymentService.verifyWebhookSignature(rawBody, String(signatureHeader))) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      const body = (req.body || {}) as PaymentWebhookBody;

      if (body.event === "payment.captured") {
        const entity = body.payload?.payment?.entity;
        const orderId = entity?.order_id;
        const paymentId = entity?.id;

        if (orderId && paymentId) {
          const payment = await paymentService.findByOrderId(orderId);
          if (payment) {
            if (payment.status !== "paid") {
              const updated = await paymentService.markPaid(payment, {
                razorpayPaymentId: paymentId,
                via: "webhook",
              });
              try {
                await conversationService.appendAuditEvents(
                  updated.conversationId.toString(),
                  [
                    {
                      message: "Payment confirmed (via webhook)",
                      status: "done",
                      kind: "payment_verified",
                      orderId,
                      via: "webhook",
                    },
                  ],
                );
              } catch (auditErr) {
                console.log("Failed to append payment_verified audit:", auditErr);
              }
            }
          } else {
            console.log(`Webhook for unknown orderId: ${orderId}`);
          }
        }
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.log("Error processing webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  getPaymentState: async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const { conversationId } = req.params;
      if (!conversationId) {
        res.status(400).json({ error: "conversationId required" });
        return;
      }

      const payment = await Payment.findOne({ conversationId }).sort({
        createdAt: -1,
      });

      if (!payment) {
        res.status(200).json({ exists: false, paid: false, payment: null });
        return;
      }

      if (payment.userId.toString() !== userId) {
        res.status(403).json({ error: "Not your conversation" });
        return;
      }

      res.status(200).json({
        exists: true,
        paid: payment.status === "paid",
        payment: {
          orderId: payment.orderId,
          status: payment.status,
          amount: payment.amount,
          finalTotal: payment.finalTotal ?? null,
          verifiedVia: payment.verifiedVia ?? null,
        },
      });
    } catch (error) {
      console.log("Error getting payment state:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
};