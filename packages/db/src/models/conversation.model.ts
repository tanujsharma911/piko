import mongoose from "mongoose";

export interface IAuditEvent {
  message: string;
  toolName?: string;
  status?: "pending" | "done" | "error" | "warning";
  kind?: string;
  response?: any;
  [key: string]: unknown;
}

export interface IMessage {
  _id?: mongoose.Types.ObjectId;
  role: "user" | "assistant" | "tool";
  content: any;
  auditEvents?: IAuditEvent[];
  createdAt: Date;
}

export interface IConversation extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new mongoose.Schema<IMessage>(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "tool"],
      required: true,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    auditEvents: {
      type: Array,
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const ConversationSchema = new mongoose.Schema<IConversation>({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  title: {
    type: String,
    default: "New chat",
  },
  messages: [messageSchema],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export const Conversation = mongoose.model<IConversation>(
  "Conversation",
  ConversationSchema,
);
