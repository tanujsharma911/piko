import type { ConversationOrder } from "@/types/orderTracking";

export type OrderLifecycle =
  | "PAYMENT_PENDING"
  | "FAILED"
  | "ACTIVE"
  | "DELIVERED"
  | "CANCELLED"
  | "NOT_DELIVERED"
  | "UNKNOWN";

const isUpiOrder = (order: ConversationOrder): boolean =>
  (order.paidVia ?? order.paymentMethod ?? "").toLowerCase().includes("upi");

const hasTerminalOrder = (order: ConversationOrder): boolean =>
  order.isTerminal || Boolean(order.terminalState);

// Conservative fallback phrasing used by Swiggy for an unpaid UPI order, used
// only when the backend did not already surface an explicit payment_pending
// state.
const PAYMENT_PENDING_KEYWORDS = ["payment", "pending"];

/**
 * Maps the available Order-doc + live Swiggy delivery snapshot into a small
 * canonical set of UI lifecycle states. It only ever reports facts we actually
 * observed — it never infers a made-up delivery stage.
 *
 * Sources of truth:
 *  - `internalStatus` (Mongo): what the user/Piko did (authorized/consumed/
 *    payment_pending/expired/cancelled). `cancelled` here is real and
 *    user-facing — it means the authorization/order was cancelled.
 *  - persisted `terminalState` (from live tracking that reached a terminal).
 *  - `lifecycle` (live Swiggy `get_delivery_status`): delivered/cancelled
 *    flags + any statusText/etaText Swiggy actually sent.
 *
 * ACTIVE is only returned when Swiggy itself asserts a stage or scheduling
 * (statusText or ETA). If Swiggy merely says "not delivered, not cancelled"
 * with no stage, we return NOT_DELIVERED — an honest, neutral state — rather
 * than guessing "in progress".
 */
export function classifyOrderStatus(order: ConversationOrder): OrderLifecycle {
  // Explicit backend signal: checkout initiated but UPI payment not done.
  if (order.internalStatus === "payment_pending") return "PAYMENT_PENDING";

  // Persisted terminal tracking state is authoritative.
  if (hasTerminalOrder(order)) {
    const t = order.terminalState?.toUpperCase() ?? "";
    if (t === "CANCELLED") return "CANCELLED";
    return "DELIVERED";
  }

  // Mongo cancellation: the user/Piko cancelled this order. Real and explicit.
  if (order.internalStatus === "cancelled") return "CANCELLED";

  const lc = order.lifecycle;

  // Live Swiggy terminal flags.
  if (lc?.delivered) return "DELIVERED";
  if (lc?.cancelled) return "CANCELLED";

  if (lc) {
    const statusText = (lc.statusText ?? "").toLowerCase();
    if (
      isUpiOrder(order) &&
      PAYMENT_PENDING_KEYWORDS.every((k) => statusText.includes(k))
    ) {
      return "PAYMENT_PENDING";
    }

    const hasStage = Boolean(lc.statusText?.trim());
    const hasEta =
      Boolean(lc.etaText) ||
      (typeof lc.deliveryBy === "number" &&
        typeof lc.serverNow === "number" &&
        lc.deliveryBy > lc.serverNow);

    // Only call it active when Swiggy actually gave a stage or ETA.
    if (hasStage || hasEta) return "ACTIVE";

    // Swiggy: not delivered, not cancelled, no stage asserted. Say exactly that.
    return "NOT_DELIVERED";
  }

  // No snapshot and no terminal info → we genuinely don't know.
  return "UNKNOWN";
}

export interface OrderPresentation {
  title: string;
  subtitle?: string;
  tone: "emerald" | "red" | "orange" | "neutral" | "muted";
}

const LOWER_ONWAY_KEYWORDS = ["on the way", "out for delivery", "delivering"];
const LOWER_ACTIVE_KEYWORDS = ["preparing", "processing", "confirmed", "placed"];

function refineActive(order: ConversationOrder): OrderPresentation {
  const rawStatusText = order.lifecycle?.statusText ?? "";
  const statusText = rawStatusText.toLowerCase();
  const etaText = order.lifecycle?.etaText;
  const lc = order.lifecycle;

  let eta: string | undefined = etaText ?? undefined;
  if (
    !eta &&
    typeof lc?.deliveryBy === "number" &&
    typeof lc?.serverNow === "number" &&
    lc.deliveryBy > lc.serverNow
  ) {
    const mins = Math.max(1, Math.round((lc.deliveryBy - lc.serverNow) / 60000));
    eta = `~${mins} min`;
  }

  // Only ever reflect what Swiggy told us — no fabricated stage labels.
  if (LOWER_ONWAY_KEYWORDS.some((k) => statusText.includes(k))) {
    return { title: "On the way", subtitle: eta ? `ETA ${eta}` : undefined, tone: "orange" };
  }
  if (LOWER_ACTIVE_KEYWORDS.some((k) => statusText.includes(k))) {
    return { title: "Preparing your order", subtitle: eta, tone: "orange" };
  }
  // Fall back to Swiggy's own wording (couldn't classify it ourselves).
  if (rawStatusText.trim()) {
    return { title: rawStatusText.trim(), subtitle: eta, tone: "orange" };
  }
  // Active with ETA but no text.
  return { title: "Order placed", subtitle: eta, tone: "orange" };
}

export function orderPresentation(
  order: ConversationOrder,
): OrderPresentation {
  const lifecycle = classifyOrderStatus(order);

  switch (lifecycle) {
    case "PAYMENT_PENDING":
      return {
        title: "Payment required",
        subtitle: "Payment is required to place order",
        tone: "neutral",
      };
    case "FAILED":
      return { title: "Order failed", tone: "red" };
    case "DELIVERED":
      return { title: "Delivered", tone: "emerald" };
    case "CANCELLED":
      return {
        title: "Cancelled",
        subtitle: order.internalStatus === "cancelled"
          ? "Order cancelled"
          : "Order cancelled by Swiggy",
        tone: "red",
      };
    case "ACTIVE":
      return refineActive(order);
    case "NOT_DELIVERED":
      return {
        title: "Not delivered yet",
        subtitle:
          order.lifecycle?.statusText?.trim() || "Awaiting delivery update",
        tone: "neutral",
      };
    case "UNKNOWN":
    default:
      return {
        title: "Order status",
        subtitle: "Unable to retrieve the latest status",
        tone: "neutral",
      };
  }
}

export type OrderAction =
  | "TRACK"
  | "COMPLETE_PAYMENT"
  | "NONE";

export function orderAction(
  order: ConversationOrder,
): { action: OrderAction; label?: string } {
  const lifecycle = classifyOrderStatus(order);

  switch (lifecycle) {
    case "ACTIVE": {
      const statusText = order.lifecycle?.statusText?.toLowerCase() ?? "";
      const onWay = LOWER_ONWAY_KEYWORDS.some((k) =>
        statusText.includes(k),
      );
      return {
        action: "TRACK",
        label: onWay ? "Track Live" : "Track Order",
      };
    }
    case "PAYMENT_PENDING":
      // No safe resume path here — show a passive message, never a broken
      // "Complete Payment" button.
      return { action: "NONE" };
    case "DELIVERED":
    case "CANCELLED":
    case "FAILED":
    case "NOT_DELIVERED":
    case "UNKNOWN":
    default:
      return { action: "NONE" };
  }
}
