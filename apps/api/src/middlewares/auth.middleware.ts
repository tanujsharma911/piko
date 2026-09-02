import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { User } from "db";

const authMiddleware = async (req: any, res: any, next: any) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (
    jwt.verify(token, config.JWT_SECRET || "default_secret") as any
  )?.id;

  const userData = await User.findById(userId);

  if (!userData) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = userData;

  next();
};

export default authMiddleware;
