import type { Request, Response } from "express";
import {
  setSSEHeaders,
  sendSSEEvent,
} from "../agent/sse.js";
import { checkSwiggyConnection } from "../agent/swiggy/connection.js";
import {
  findOrderAuthorization,
  findConversationOrders,
  fetchLifecycleSnapshot,
  resolveTrackState,
  recordTerminalTracking,
  getStoredTracking,
  sleep,
} from "../commerce/order-tracking.service.js";
import {
  dbg,
  resolveCoordinatesForTrack,
} from "../commerce/tracking-debug.js";
import type {
  DebugCoordinates,
  CoordinateSource,
} from "../commerce/tracking-debug.js";

interface AuthRequest extends Request {
  user?: { id: string; email: string; name: string };
}

const MAX_POLLS = 240;

export const orderTrackingController = {
  listConversationOrders: async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const conversationId =
        typeof req.params.conversationId === "string"
          ? req.params.conversationId
          : undefined;

      if (!userId) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }
      if (!conversationId) {
        res.status(400).json({ message: "conversationId is required" });
        return;
      }

      const authorizations = await findConversationOrders(
        userId,
        conversationId,
      );

      let connection: Awaited<ReturnType<typeof checkSwiggyConnection>> | null =
        null;
      try {
        const checked = await checkSwiggyConnection(userId);
        if (checked.isSwiggyConnected) connection = checked;
      } catch {
        connection = null;
      }

      const orders = [];
      for (const auth of authorizations) {
        const stored = await getStoredTracking(userId, auth.swiggyOrderId!);
        const isTerminal = !!stored?.terminalState;
        let lifecycle = null;

        if (!isTerminal && connection) {
          lifecycle = await fetchLifecycleSnapshot(
            connection.swiggyAccessToken,
            auth.swiggyOrderId!,
            auth.addressId,
          );
        }

        orders.push({
          orderId: auth.swiggyOrderId,
          paymentMethod: auth.paymentMethod,
          amount: auth.amount ?? null,
          paidVia: auth.swiggyPaasId ? "upi" : auth.paymentMethod,
          internalStatus: auth.status,
          placedAt: auth.updatedAt,
          authorizedAt: auth.authorizedAt || null,
          consumedAt: auth.consumedAt || null,
          updatedAt: auth.updatedAt,
          isTerminal,
          terminalState: stored?.terminalState || null,
          lastStatusText: stored?.lastStatusText || null,
          lastTrackedAt: stored?.lastTrackedAt || null,
          lifecycle: lifecycle
            ? {
                delivered: lifecycle.delivered,
                cancelled: lifecycle.cancelled,
                statusText: lifecycle.statusText ?? null,
                etaText: lifecycle.etaText ?? null,
                deliveryBy: lifecycle.deliveryBy ?? null,
                serverNow: lifecycle.serverNow ?? null,
              }
            : null,
        });
      }

      res.status(200).json({ orders });
    } catch (error) {
      console.log("Error in listConversationOrders:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  trackOrderStream: async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const orderId =
      typeof req.params.orderId === "string" ? req.params.orderId : undefined;

    if (!userId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    if (!orderId) {
      res.status(400).json({ message: "orderId is required" });
      return;
    }

    let authorization;
    let connection;
    const stored = await getStoredTracking(userId, orderId);

    try {
      authorization = await findOrderAuthorization(userId, orderId);
    } catch (error) {
      console.log("Error resolving order authorization:", error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    if (!authorization) {
      res.status(404).json({ message: "Order not found for this user" });
      return;
    }

    try {
      connection = await checkSwiggyConnection(userId);
    } catch (error) {
      console.log("Error checking Swiggy connection:", error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    if (!connection.isSwiggyConnected) {
      res.status(400).json({ message: "Swiggy not connected" });
      return;
    }

    setSSEHeaders(res);

    const terminalStorage = stored || null;

    if (terminalStorage?.terminalState) {
      sendSSEEvent(res, {
        type: "tracking",
        data: {
          orderId,
          isTerminal: true,
          terminalState: terminalStorage.terminalState,
          statusMessage: terminalStorage.lastStatusText || "",
          source: "delivery_status",
          updatedAt: new Date().toISOString(),
        },
      });
      sendSSEEvent(res, { type: "done" });
      res.end();
      return;
    }

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    const send = (event: any) => {
      if (!closed && !res.writableEnded) sendSSEEvent(res, event);
    };

    const addressId = authorization.addressId;
    const trackingStart = Date.now();
    const requestId =
      Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);

    // A. REQUEST START
    dbg("A.REQUEST_START", "tracking request started", {
      requestId,
      orderId,
      userId,
      conversationId: authorization.conversationId?.toString() ?? null,
      addressId: addressId ?? null,
      timestamp: new Date().toISOString(),
      trackingAttemptNumber: 1,
      maxPolls: MAX_POLLS,
    });

    // Coordinate resolution (temporary investigation flow):
    //   1. swiggy_response  2. geocoding_fallback  3. unavailable.
    // Never cached; never reused from another order.
    let coordinateResult: {
      coordinates: DebugCoordinates | null;
      source: CoordinateSource;
      address?: string | null;
    } = {
      coordinates: null,
      source: "unavailable",
      address: null,
    };
    try {
      coordinateResult = await resolveCoordinatesForTrack(
        connection.swiggyAccessToken,
        orderId,
      );
    } catch (error: any) {
      dbg("COORDINATES.ERROR", "coordinate resolution failed", {
        requestId,
        errorType: error?.constructor?.name,
        errorMessage: error?.message,
      });
    }
    const coordinates = coordinateResult.coordinates;
    dbg("COORDINATES.FINAL", "coordinate source decided", {
      requestId,
      source: coordinateResult.source,
      hasCoordinates: !!coordinates,
      addressForGeocoding: coordinateResult.address ?? null,
    });

    let polls = 0;
    let terminal = false;
    let totalGetDeliveryStatus = 0;
    let totalTrackOrder = 0;
    let lastStatusMessage: string | null = null;
    let lastRiderLat: number | null = null;
    let lastTerminalState: string | null = null;
    let everReceivedRiderLocation = false;
    let everReceivedMapInfo = false;
    let stopReason: string | null = null;

    try {
      while (!closed && polls < MAX_POLLS) {
        polls++;
        if (!addressId) {
          stopReason = "no delivery address for tracking";
          throw new Error("Order has no delivery address for tracking");
        }

        // H. POLLING
        dbg("H.POLL.START", "poll iteration starting", {
          requestId,
          pollNumber: polls,
          timestamp: new Date().toISOString(),
        });

        const state = await resolveTrackState({
          token: connection.swiggyAccessToken,
          orderId,
          addressId,
          coordinates,
          coordinateSource: coordinateResult.source,
          orderDoc: {
            swiggyOrderId: authorization.swiggyOrderId ?? null,
            addressId: authorization.addressId ?? null,
            paymentMethod: authorization.paymentMethod ?? null,
            terminalState: authorization.terminalState ?? null,
            lastStatusText: authorization.lastStatusText ?? null,
            status: authorization.status ?? null,
          },
          conversationId: authorization.conversationId?.toString() ?? null,
          userId,
          pollNumber: polls,
          requestId,
        });
        totalGetDeliveryStatus++; // F: get_delivery_status always runs
        if (coordinates) totalTrackOrder++; // G: track_order runs when coords present

        const statusChanged =
          lastStatusMessage !== null &&
          state.statusMessage !== lastStatusMessage;
        const riderChanged =
          everReceivedRiderLocation &&
          state.riderLocation != null &&
          lastRiderLat !== state.riderLocation.latitude;

        dbg("H.POLL.RESULT", "poll state received", {
          requestId,
          pollNumber: polls,
          toolUsed: coordinates ? "track_order" : "get_delivery_status",
          pollingIntervalSeconds: state.pollingIntervalSeconds,
          statusMessage: state.statusMessage,
          statusChanged,
          previousStatus: lastStatusMessage,
          riderLocation: state.riderLocation ?? null,
          riderLocationChanged: riderChanged,
          isTerminal: state.isTerminal,
          terminalState: state.terminalState ?? null,
        });

        send({ type: "tracking", data: state });

        if (state.riderLocation != null) {
          everReceivedRiderLocation = true;
          if (state.riderLocation.latitude != null) {
            lastRiderLat = state.riderLocation.latitude;
          }
        }
        if (state.source === "track_order") everReceivedMapInfo = true;
        if (state.statusMessage != null) lastStatusMessage = state.statusMessage;

        if (state.isTerminal) {
          terminal = true;
          lastTerminalState = state.terminalState ?? null;
          stopReason = "terminal state reached";
          await recordTerminalTracking(userId, orderId, state);
          break;
        }

        const intervalMs = Math.max(
          1000,
          state.pollingIntervalSeconds * 1000,
        );
        await sleep(intervalMs);
      }
      if (!terminal && !closed) {
        stopReason = `max polls reached (${MAX_POLLS})`;
      }
      if (closed) {
        stopReason = "client disconnected";
      }
    } catch (error: any) {
      stopReason = stopReason ?? `error: ${error?.message || "unknown error"}`;
      dbg("TRACKING.ERROR", "tracking stream error", {
        requestId,
        errorType: error?.constructor?.name,
        errorMessage: error?.message,
        stack: error?.stack,
      });
      send({ type: "error", message: "Tracking failed: " + (error?.message || "unknown error") });
    }

    // I. FINAL RESULT
    dbg("I.FINAL_RESULT", "tracking session finished", {
      requestId,
      orderId,
      finalStatusMessage: lastStatusMessage,
      terminal,
      terminalState: lastTerminalState,
      everReceivedRiderLocation,
      everReceivedMapInfo,
      coordinateSource: coordinateResult.source,
      numberOfTrackOrderCalls: totalTrackOrder,
      numberOfGetDeliveryStatusCalls: totalGetDeliveryStatus,
      totalTrackingDurationMs: Date.now() - trackingStart,
      stopReason,
    });

    if (terminal) {
      send({ type: "done" });
    }
    if (!res.writableEnded) {
      res.end();
    }
  },
};