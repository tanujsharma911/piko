import crypto from "crypto";
import type { IPayment } from "db";
import { Payment } from "db";
import Razorpay from "razorpay";
import { config } from "../config/env.js";

const razorpay = new Razorpay({
  key_id: config.RAZORPAY_KEY_ID,
  key_secret: config.RAZORPAY_KEY_SECRET,
});

export interface CreateOrderParams {
  userId: string;
  conversationId: string;
  amount: number;
  receipt?: string;
  notes?: Record<string, string>;
}

export const paymentService = {
  client: razorpay,

  findByOrderId: async (orderId: string): Promise<IPayment | null> => {
    return Payment.findOne({ orderId });
  },

  createOrder: async (
    params: CreateOrderParams,
  ): Promise<IPayment> => {
    const order = await razorpay.orders.create({
      amount: params.amount,
      currency: "INR",
      ...(params.receipt ? { receipt: params.receipt } : {}),
      ...(params.notes ? { notes: params.notes } : {}),
    });

    const payment = await Payment.create({
      orderId: order.id,
      amount: params.amount,
      currency: "INR",
      status: "created",
      source: "swiggy_cart_total",
      conversationId: params.conversationId,
      userId: params.userId,
    });

    return payment;
  },

  verifySignature: (orderId: string, razorpayPaymentId: string, signature: string): boolean => {
    const expected = crypto
      .createHmac("sha256", config.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${razorpayPaymentId}`)
      .digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  verifyWebhookSignature: (rawBody: string, signatureHeader: string): boolean => {
    const expected = crypto
      .createHmac("sha256", config.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signatureHeader, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  markPaid: async (
    payment: IPayment,
    opts: { razorpayPaymentId: string; via: "client" | "webhook" },
  ): Promise<IPayment> => {
    payment.razorpayPaymentId = opts.razorpayPaymentId;
    payment.status = "paid";
    payment.verifiedVia = opts.via;
    payment.paidAt = new Date();
    await payment.save();
    return payment;
  },
};