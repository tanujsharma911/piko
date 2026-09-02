import mongoose, { Schema, Document } from "mongoose";

export interface IPayment extends Document {
  orderId: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  status: "created" | "paid";
  source: string;
  conversationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  finalTotal?: number;
  verifiedVia?: "client" | "webhook";
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    orderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    source: { type: String, default: "swiggy_cart_total" },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    finalTotal: { type: Number },
    verifiedVia: { type: String, enum: ["client", "webhook"] },
    paidAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);