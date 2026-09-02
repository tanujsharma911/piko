import mongoose, { Schema, Document } from "mongoose";

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  status:
    | "authorized"
    | "payment_pending"
    | "consumed"
    | "expired"
    | "cancelled";
  cartId?: string;
  cartHash?: string;
  amount?: number;
  addressId?: string;
  paymentMethod?: string;
  authorizedAt?: Date;
  expiresAt?: Date;
  consumedAt?: Date;
  swiggyOrderId?: string;
  swiggyPaasId?: string;
  terminalState?: string;
  lastStatusText?: string;
  lastTrackedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "authorized",
        "payment_pending",
        "consumed",
        "expired",
        "cancelled",
      ],
      default: "authorized",
      index: true,
    },
    cartId: { type: String },
    cartHash: { type: String },
    amount: { type: Number },
    addressId: { type: String },
    paymentMethod: { type: String },
    authorizedAt: { type: Date },
    expiresAt: { type: Date },
    consumedAt: { type: Date },
    swiggyOrderId: { type: String },
    swiggyPaasId: { type: String },
    terminalState: { type: String },
    lastStatusText: { type: String },
    lastTrackedAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

orderSchema.index(
  { userId: 1, conversationId: 1, status: 1 },
  { name: "order_user_conv_status" },
);
orderSchema.index(
  { userId: 1, swiggyOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { swiggyOrderId: { $type: "string" } },
    name: "order_user_swiggy",
  },
);

export const Order = mongoose.model<IOrder>("Order", orderSchema);
