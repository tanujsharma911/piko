import type { Request, Response } from "express";
import { userService } from "../services/user.service.js";
import type { AuthRequest } from "../types/types.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const authController = {
  login: async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ message: "Email and password are required" });
        return;
      }

      const user = await userService.getUserByEmail(email, {
        withPassword: true,
      });
      if (!user) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }

      const isMatch = await user.comparePassword(user.password, password);
      if (!isMatch) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }

      const token = user.generateToken();

      res.cookie("token", token, COOKIE_OPTIONS);
      res.status(200).json({
        user: { id: user._id, name: user.name, email: user.email },
        token,
      });
    } catch (error) {
      console.log("Error in login:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  register: async (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        res
          .status(400)
          .json({ message: "Name, email and password are required" });
        return;
      }

      const existingUser = await userService.getUserByEmail(email);
      if (existingUser) {
        res.status(409).json({ message: "User already exists" });
        return;
      }

      const user = await userService.createUser({ name, email, password });
      const token = user.generateToken();

      res.cookie("token", token, COOKIE_OPTIONS);
      res.status(201).json({
        user: { id: user._id, name: user.name, email: user.email },
        token,
      });
    } catch (error) {
      console.log("Error in register:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  getMe: async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      res.status(200).json({
        user: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
        },
      });
    } catch (error) {
      console.log("Error in getMe:", error);
      res.status(401).json({ message: "Invalid or expired token" });
    }
  },

  logout: async (_req: Request, res: Response) => {
    res.cookie("token", "", { maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully" });
  },
};
