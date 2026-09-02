import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.route.js";
import conversationRouter from "./routes/conversation.route.js";
import swiggyRouter from "./routes/swiggy.route.js";
import paymentRouter from "./routes/payment.route.js";
import orderTrackingRouter from "./routes/order-tracking.route.js";
import mongoose from "mongoose";
import { config } from "./config/env.js";
import { getSwiggyClientId } from "./agent/swiggy-dcr.js";
import dotenv from "dotenv";

dotenv.config();

mongoose.connect(`${config.MONGODB_URL}/agentic_commerce`);

getSwiggyClientId().catch((err) => {
  console.error("Failed to register Swiggy client:", err);
});

const app = express();

app.use(
  cors({
    origin: config.CORS_ORIGINS,
    credentials: true,
  }),
);
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(cookieParser());

app.use("/auth", authRouter);
app.use("/conversations", conversationRouter);
app.use("/swiggy", swiggyRouter);
app.use("/payments", paymentRouter);
app.use("/orders", orderTrackingRouter);

app.listen(3535, () => {
  console.log("Server running on http://localhost:3535");
});
