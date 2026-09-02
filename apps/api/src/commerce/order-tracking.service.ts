import { Order } from "db";
import { getSwiggyInstaMartTools } from "../agent/swiggy/instamart/tools.js";
import { unwrapToolResult } from "./checkout.service.js";
import { dbg, logRaw, byteSize } from "./tracking-debug.js";
import type {
  CoordinateSource,
  DebugCoordinates,
} from "./tracking-debug.js";

export interface TrackingLocation {
  latitude: number;
  longitude: number;
}

export interface TrackingState {
  orderId: string;
  orderTitle?: string;
  orderSubtitle?: string;
  statusMessage: string;
  subStatusMessage?: string;
  statusText?: string;
  etaMinutes?: number;
  etaText?: string;
  deliveryBy?: number;
  serverNow?: number;
  storeInfo?: { name: string; address: string };
  deliveryInfo?: { addressLabel?: string; fullAddress: string };
  itemCount?: number;
  items?: Array<{ name: string; quantity: number; price: string }>;
  placedAt?: string;
  storeLocation?: TrackingLocation;
  deliveryLocation?: TrackingLocation;
  riderLocation?: TrackingLocation;
  pollingIntervalSeconds: number;
  isTerminal: boolean;
  terminalState?: string;
  source: "track_order" | "delivery_status";
  updatedAt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function findOrderAuthorization(userId: string, orderId: string) {
  return Order.findOne({
    userId,
    swiggyOrderId: orderId,
  });
}

export async function findConversationOrders(userId: string, conversationId: string) {
  return Order.find({
    userId,
    conversationId,
    swiggyOrderId: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .select(
      "swiggyOrderId swiggyPaasId addressId paymentMethod status amount authorizedAt consumedAt createdAt updatedAt",
    );
}

export interface LifecycleSnapshot {
  delivered: boolean;
  cancelled: boolean;
  statusText?: string;
  etaText?: string;
  deliveryBy?: number;
  serverNow?: number;
}

export async function fetchLifecycleSnapshot(
  token: string,
  orderId: string,
  addressId: string | null | undefined,
): Promise<LifecycleSnapshot | null> {
  if (!addressId) return null;
  try {
    const tools = await getSwiggyInstaMartTools(token);
    const byName = new Map(tools.map((t: any) => [t.name, t]));
    const deliveryStatusTool = byName.get(
      "swiggy-instamart__get_delivery_status",
    );
    if (!deliveryStatusTool) return null;

    const result = unwrapToolResult(
      await deliveryStatusTool.invoke({ orderId, addressId }),
    );
    if (!result) return null;

    return {
      delivered: result.delivered === true,
      cancelled: result.cancelled === true,
      statusText:
        typeof result.statusText === "string"
          ? result.statusText
          : undefined,
      etaText: typeof result.etaText === "string" ? result.etaText : undefined,
      deliveryBy:
        typeof result.deliveryBy === "number" ? result.deliveryBy : undefined,
      serverNow:
        typeof result.serverNow === "number" ? result.serverNow : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeDeliveryStatus(
  orderId: string,
  order: any,
): TrackingState {
  const delivered = order.delivered === true;
  const cancelled = order.cancelled === true;
  const deliveryBy = typeof order.deliveryBy === "number" ? order.deliveryBy : undefined;
  const serverNow = typeof order.serverNow === "number" ? order.serverNow : undefined;
  const statusText = typeof order.statusText === "string" ? order.statusText : undefined;
  const etaMinutes =
    deliveryBy && serverNow && deliveryBy > serverNow
      ? Math.max(1, Math.round((deliveryBy - serverNow) / 60000))
      : undefined;
  const statusMessage =
    statusText?.trim() ||
    (delivered ? "Delivered" : cancelled ? "Cancelled" : "");

  const state: TrackingState = {
    orderId,
    statusMessage,
    statusText: statusText || undefined,
    etaText: typeof order.etaText === "string" ? order.etaText : undefined,
    deliveryBy,
    serverNow,
    pollingIntervalSeconds:
      typeof order.pollIntervalSec === "number" && order.pollIntervalSec > 0
        ? order.pollIntervalSec
        : 30,
    isTerminal: delivered || cancelled,
    source: "delivery_status",
    updatedAt: new Date().toISOString(),
  };
  if (etaMinutes !== undefined) {
    state.etaMinutes = etaMinutes;
  }
  if (delivered || cancelled) {
    state.terminalState = delivered ? "DELIVERED" : "CANCELLED";
  }
  return state;
}

function normalizeTrackOrder(orderId: string, order: any): TrackingState {
  const status = order.status || {};
  const mapInfo = order.mapInfo || {};
  const storeLocation = mapInfo.storeLocation;
  const deliveryLocation = mapInfo.deliveryLocation;
  const riderLocation = mapInfo.riderLocation;

  const hasLocation =
    storeLocation?.latitude != null ||
    deliveryLocation?.latitude != null ||
    riderLocation?.latitude != null;

  return {
    orderId,
    orderTitle: order.orderTitle || undefined,
    orderSubtitle: order.orderSubtitle || undefined,
    statusMessage: status.statusMessage || "",
    subStatusMessage: status.subStatusMessage || undefined,
    etaMinutes: status.etaMinutes,
    etaText: status.etaText,
    storeInfo: order.storeInfo,
    deliveryInfo: order.deliveryInfo,
    itemCount: order.itemCount,
    items: order.items,
    placedAt: order.placedAt,
    storeLocation,
    deliveryLocation,
    riderLocation,
    pollingIntervalSeconds:
      typeof order.pollingIntervalSeconds === "number" &&
      order.pollingIntervalSeconds > 0
        ? order.pollingIntervalSeconds
        : 30,
    isTerminal: false,
    source: hasLocation ? "track_order" : "delivery_status",
    updatedAt: new Date().toISOString(),
  };
}

export interface TrackStateInput {
  token: string;
  orderId: string;
  addressId: string;
  coordinates?: DebugCoordinates | null;
  coordinateSource?: CoordinateSource;
  orderDoc?: Record<string, unknown> | null;
  conversationId?: string | null;
  userId?: string | null;
  pollNumber?: number;
  requestId?: string;
}

export async function resolveTrackState(
  input: TrackStateInput,
): Promise<TrackingState> {
  const { token, orderId, coordinateSource } = input;

  // B. ORDER DATA — log the raw Order document fields relevant to tracking.
  dbg("B.ORDER_DATA", "order document fields", {
    swiggyOrderId: input.orderDoc?.swiggyOrderId ?? orderId,
    addressId: input.orderDoc?.addressId ?? input.addressId,
    paymentMethod: input.orderDoc?.paymentMethod ?? null,
    terminalState: input.orderDoc?.terminalState ?? null,
    lastStatusText: input.orderDoc?.lastStatusText ?? null,
    status: input.orderDoc?.status ?? null,
  });

  const tools = await getSwiggyInstaMartTools(token);
  const byName = new Map(tools.map((t: any) => [t.name, t]));

  const deliveryStatusTool = byName.get(
    "swiggy-instamart__get_delivery_status",
  );
  let state: TrackingState | null = null;

  if (deliveryStatusTool) {
    const args = { orderId, addressId: input.addressId };
    dbg("F.GET_DELIVERY_STATUS.REQUEST", "get_delivery_status request", { args });
    try {
      const raw = await deliveryStatusTool.invoke(args);
      logRaw("F.GET_DELIVERY_STATUS", "swiggy-instamart__get_delivery_status", raw);
      const result = unwrapToolResult(raw);
      if (result) {
        state = normalizeDeliveryStatus(orderId, result);
        dbg("F.GET_DELIVERY_STATUS.NORMALIZED", "get_delivery_status normalized", {
          rawByteSize: byteSize(raw),
          statusText: state.statusText,
          statusMessage: state.statusMessage,
          subStatusMessage: state.subStatusMessage,
          etaText: state.etaText,
          etaMinutes: state.etaMinutes,
          pollingIntervalSeconds: state.pollingIntervalSeconds,
          isTerminal: state.isTerminal,
          terminalState: state.terminalState,
        });
      }
    } catch (err: any) {
      dbg("F.GET_DELIVERY_STATUS.ERROR", "get_delivery_status failed", {
        tool: "swiggy-instamart__get_delivery_status",
        args,
        errorType: err?.constructor?.name,
        errorMessage: err?.message,
        stack: err?.stack,
      });
    }
  }

  const trackOrderTool = byName.get("swiggy-instamart__track_order");
  const isTerminal = state?.isTerminal === true;

  dbg("G.TRACK_ORDER.DECISION", "track_order decision", {
    hasTrackOrderTool: !!trackOrderTool,
    hasCoordinates: !!input.coordinates,
    coordinateSource,
    isTerminal,
    willCallTrackOrder: !!trackOrderTool && !!input.coordinates && !isTerminal,
  });

  if (trackOrderTool && input.coordinates && !isTerminal) {
    const args = {
      orderId,
      lat: input.coordinates.latitude,
      lng: input.coordinates.longitude,
    };
    dbg("G.TRACK_ORDER.REQUEST", "track_order request", {
      args,
      coordinateSource:
        input.coordinateSource ?? input.coordinates.source ?? null,
      coordinatesFrom: input.coordinates.source,
    });
    try {
      const raw = await trackOrderTool.invoke(args);
      logRaw("G.TRACK_ORDER", "swiggy-instamart__track_order", raw);
      const result = unwrapToolResult(raw);
      if (result && result.orderId) {
        const trackState = normalizeTrackOrder(orderId, result);
        dbg("G.TRACK_ORDER.NORMALIZED", "track_order normalized", {
          rawByteSize: byteSize(raw),
          statusMessage: trackState.statusMessage,
          subStatusMessage: trackState.subStatusMessage,
          etaText: trackState.etaText,
          etaMinutes: trackState.etaMinutes,
          pollingIntervalSeconds: trackState.pollingIntervalSeconds,
          storeLocation: trackState.storeLocation,
          deliveryLocation: trackState.deliveryLocation,
          riderLocation: trackState.riderLocation,
          hasStoreLocation: !!trackState.storeLocation,
          hasDeliveryLocation: !!trackState.deliveryLocation,
          hasRiderLocation: !!trackState.riderLocation,
        });
        state = {
          ...state,
          ...trackState,
          isTerminal: false,
        };
      } else {
        dbg("G.TRACK_ORDER.RESPONSE", "track_order returned no orderId", {
          parsedNotNull:
            result != null && typeof result === "object",
          hasOrderId: !!result?.orderId,
        });
      }
    } catch (err: any) {
      dbg("G.TRACK_ORDER.ERROR", "track_order failed", {
        tool: "swiggy-instamart__track_order",
        args,
        errorType: err?.constructor?.name,
        errorMessage: err?.message,
        stack: err?.stack,
      });
    }
  } else {
    dbg("G.TRACK_ORDER", "track_order skipped (no coords or terminal or tool)", {
      hasTrackOrderTool: !!trackOrderTool,
      hasCoordinates: !!input.coordinates,
      isTerminal,
    });
  }

  if (state) return state;

  throw new Error("Swiggy returned no tracking data for this order");
}

export async function recordTerminalTracking(
  userId: string,
  orderId: string,
  state: TrackingState,
): Promise<void> {
  await Order.updateOne(
    { userId, swiggyOrderId: orderId },
    {
      $set: {
        terminalState: state.terminalState || "TERMINAL",
        lastStatusText: state.statusMessage || state.statusText || "",
        lastTrackedAt: new Date(),
      },
    },
  );
}

export async function getStoredTracking(userId: string, orderId: string) {
  return Order.findOne({ userId, swiggyOrderId: orderId });
}

export { sleep };