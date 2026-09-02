import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2Icon,
  TruckIcon,
  XIcon,
  PackageCheckIcon,
  XCircleIcon,
  WalletIcon,
  ClockIcon,
} from "lucide-react";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import TrackingMap from "./TrackingMap";
import {
  classifyOrderStatus,
  orderAction,
  orderPresentation,
  type OrderLifecycle,
} from "./orderLifecycle";
import type { ConversationOrder, TrackingState } from "@/types/orderTracking";

const formatEta = (state: TrackingState | null): string | null => {
  if (!state) return null;
  if (typeof state.etaMinutes === "number" && state.etaMinutes > 0) {
    return `~${state.etaMinutes} min`;
  }
  if (state.etaText) return state.etaText;
  if (
    state.deliveryBy &&
    state.serverNow &&
    state.deliveryBy > state.serverNow
  ) {
    const mins = Math.max(
      1,
      Math.round((state.deliveryBy - state.serverNow) / 60000),
    );
    return `~${mins} min`;
  }
  return null;
};

const formatDateTime = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const LIFECYCLE_ICON: Record<OrderLifecycle, React.ReactNode> = {
  PAYMENT_PENDING: <WalletIcon className="size-4 text-amber-500" />,
  FAILED: <XCircleIcon className="size-4 text-red-600" />,
  ACTIVE: <TruckIcon className="size-4 text-orange-500" />,
  DELIVERED: <PackageCheckIcon className="size-4 text-emerald-600" />,
  CANCELLED: <XCircleIcon className="size-4 text-red-600" />,
  NOT_DELIVERED: <ClockIcon className="size-4 text-muted-foreground" />,
  UNKNOWN: <ClockIcon className="size-4 text-muted-foreground" />,
};

const TONE_BADGE: Record<
  string,
  string
> = {
  emerald: "bg-emerald-600/10 text-emerald-700",
  red: "bg-red-600/10 text-red-700",
  orange: "bg-orange-600/10 text-orange-700",
  neutral: "bg-muted text-muted-foreground",
  muted: "bg-muted text-muted-foreground",
};

const OrderCard = ({
  order,
  onTerminal,
}: {
  order: ConversationOrder;
  onTerminal?: (orderId: string) => void;
}) => {
  const { status, state, error, start, stop } = useOrderTracking(order.orderId);

  const presentation = useMemo(() => orderPresentation(order), [order]);
  const lifecycle = useMemo(() => classifyOrderStatus(order), [order]);
  const { action, label } = useMemo(() => orderAction(order), [order]);

  const isLive = status === "tracking" || status === "connecting";

  useEffect(() => {
    if (status === "terminal") {
      onTerminal?.(order.orderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, order.orderId]);

  const eta = useMemo(
    () => formatEta(isLive ? state : null),
    [isLive, state],
  );

  const showMap =
    isLive &&
    !!state &&
    (!!state.storeLocation ||
      !!state.deliveryLocation ||
      !!state.riderLocation);

  const lc = order.lifecycle;
  const swiggyDelivery = [
    lc ? (lc.delivered ? "Delivered" : "Not delivered") : null,
    lc ? (lc.cancelled ? "Cancelled" : "Not cancelled") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const paymentLabel = (order.paidVia || order.paymentMethod || "")
    ? `${(order.paidVia || order.paymentMethod || "").toUpperCase()} · ₹${order.amount ?? "—"}`
    : null;

  const detailRows = [
    { label: "Delivery (Swiggy)", value: swiggyDelivery || "Not fetched" },
    { label: "Payment", value: paymentLabel || "—" },
    {
      label: "Mongo status",
      value: order.internalStatus ? String(order.internalStatus) : "—",
    },
  ];

  const stamps: Array<{ label: string; time: string | null }> = [
    { label: "Authorized", time: formatDateTime(order.authorizedAt) },
    { label: "Consumed", time: formatDateTime(order.consumedAt) },
    { label: "Updated", time: formatDateTime(order.updatedAt) },
  ].filter((s) => s.time);

  return (
    <div className="mb-2 w-full rounded-xl border">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {LIFECYCLE_ICON[lifecycle] ?? LIFECYCLE_ICON.UNKNOWN}
          <span className="text-muted-foreground">#{order.orderId}</span>
        </div>
        {isLive && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={stop}
            aria-label="Stop tracking"
          >
            <XIcon />
          </Button>
        )}
      </div>

      <div className="px-4 py-3">
        {isLive ? (
          <div className="space-y-2">
            {state?.orderTitle && (
              <p className="truncate text-sm font-medium">{state.orderTitle}</p>
            )}
            <p className="text-sm">
              <span className="font-medium">{state?.statusMessage}</span>
              {state?.subStatusMessage && (
                <span className="text-muted-foreground">
                  {" "}
                  · {state.subStatusMessage}
                </span>
              )}
            </p>
            {eta && (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <TruckIcon className="size-3.5" />
                Arriving {eta}
              </p>
            )}
            {showMap ? (
              <TrackingMap
                storeLocation={state?.storeLocation}
                deliveryLocation={state?.deliveryLocation}
                riderLocation={state?.riderLocation}
              />
            ) : (
              <>
                {!eta && (
                  <p className="text-xs text-muted-foreground">
                    {state?.statusMessage || "Live tracking updates below."}
                  </p>
                )}
              </>
            )}
          </div>
        ) : action === "NONE" ? (
          <div className="flex flex-col gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                TONE_BADGE[presentation.tone] ?? TONE_BADGE.neutral
              }`}
            >
              {presentation.title}
            </span>
            {presentation.subtitle && (
              <p className="text-sm text-muted-foreground">
                {presentation.subtitle}
              </p>
            )}
            <div className="mt-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              {detailRows.map(
                (row) =>
                  row.value &&
                  row.value !== "—" && (
                    <div
                      key={row.label}
                      className="flex items-start justify-between gap-3 py-0.5"
                    >
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="text-right font-medium">
                        {row.value}
                      </span>
                    </div>
                  ),
              )}
              {stamps.length > 0 && (
                <div className="mt-1 border-t pt-1">
                  {stamps.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-start justify-between gap-3 py-0.5"
                    >
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="text-right font-medium">{s.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                TONE_BADGE[presentation.tone] ?? TONE_BADGE.neutral
              }`}
            >
              {presentation.title}
            </span>
            {presentation.subtitle && (
              <p className="text-sm text-muted-foreground">
                {presentation.subtitle}
              </p>
            )}
            <Button className="w-full" onClick={start} size="sm">
              <TruckIcon className="size-4" />
              {label || "Track Order"}
            </Button>
          </div>
        )}

        {status === "connecting" && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Connecting to Swiggy...
          </p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
};

export default OrderCard;
