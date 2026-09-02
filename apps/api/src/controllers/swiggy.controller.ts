import crypto from "crypto";
import type { Request, Response } from "express";
import { User } from "db";
import { config } from "../config/env.js";
import { getSwiggyClientId } from "../agent/swiggy-dcr.js";
import { saveState, consumeState } from "../agent/swiggy-state.js";
import type { AuthRequest } from "../types/types.js";

export const swiggyController = {
  connect: async (req: AuthRequest, res: Response) => {
    try {
      const userId = (req.user as any)?._id?.toString();
      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      const state = crypto.randomBytes(16).toString("hex");

      saveState(state, userId, codeVerifier);

      const clientId = await getSwiggyClientId();

      const url = new URL(`${config.SWIGGY_AUTH_BASE}/auth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", config.SWIGGY_REDIRECT_URI);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "mcp:tools");

      res.json({ url: url.toString() });
    } catch (error) {
      console.log("Error in swiggy connect:", error);
      res.status(500).json({ message: "Failed to initiate Swiggy connection" });
    }
  },

  callback: async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };

      if (!code || !state) {
        res.redirect(`${config.FRONTEND_URL}/?swiggy=error`);
        return;
      }

      const stored = consumeState(state);
      if (!stored) {
        res.redirect(`${config.FRONTEND_URL}/?swiggy=error`);
        return;
      }

      const clientId = await getSwiggyClientId();

      const tokenRes = await fetch(`${config.SWIGGY_AUTH_BASE}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          code_verifier: stored.verifier,
          client_id: clientId,
          redirect_uri: config.SWIGGY_REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        console.log("Swiggy token exchange failed:", tokenRes.status);
        res.redirect(`${config.FRONTEND_URL}/?swiggy=error`);
        return;
      }

      const { access_token, expires_in } = (await tokenRes.json()) as {
        access_token: string;
        expires_in: number;
      };
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      await User.findByIdAndUpdate(stored.userId, {
        swiggyAccessToken: access_token,
        swiggyTokenExpiresAt: expiresAt,
      } as any);

      res.redirect(`${config.FRONTEND_URL}/?swiggy=connected`);
    } catch (error) {
      console.log("Error in swiggy callback:", error);
      res.redirect(`${config.FRONTEND_URL}/?swiggy=error`);
    }
  },

  status: async (req: AuthRequest, res: Response) => {
    try {
      const userId = (req.user as any)?._id?.toString();
      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const user = await User.findById(userId).select(
        "+swiggyAccessToken +swiggyTokenExpiresAt",
      );

      const connected =
        !!user?.swiggyAccessToken &&
        !!user?.swiggyTokenExpiresAt &&
        user.swiggyTokenExpiresAt > new Date();

      res.json({
        connected,
        expiresAt: user?.swiggyTokenExpiresAt?.toISOString() || null,
      });
    } catch (error) {
      console.log("Error in swiggy status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  disconnect: async (req: AuthRequest, res: Response) => {
    try {
      const userId = (req.user as any)?._id?.toString();
      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      const user = await User.findById(userId).select("+swiggyAccessToken");
      if (user?.swiggyAccessToken) {
        await fetch(`${config.SWIGGY_AUTH_BASE}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${user.swiggyAccessToken}` },
        }).catch(() => {});
      }

      await User.findByIdAndUpdate(userId, {
        $unset: {
          swiggyAccessToken: 1,
          swiggyTokenExpiresAt: 1,
        },
      });

      res.json({ message: "Disconnected" });
    } catch (error) {
      console.log("Error in swiggy disconnect:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
};
