import dotenv from "dotenv";

dotenv.config();

export const config = {
  MONGODB_URL: process.env.MONGODB_URL || "mongodb://localhost:27017",
  JWT_SECRET: process.env.JWT_SECRET || "your_jwt_secret_key",
  CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5173",
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  SWIGGY_REDIRECT_URI:
    process.env.SWIGGY_REDIRECT_URI ||
    "http://localhost:3535/swiggy/callback",
  SWIGGY_AUTH_BASE: "https://mcp.swiggy.com",
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "",
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  PIKO_MAX_ORDER_AMOUNT: parseInt(process.env.PIKO_MAX_ORDER_AMOUNT || "500", 10),
  CHECKOUT_AUTH_EXPIRY_MINUTES: parseInt(process.env.CHECKOUT_AUTH_EXPIRY_MINUTES || "5", 10),
};
