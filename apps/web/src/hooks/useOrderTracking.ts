import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "@/config/env";
import type { TrackingState } from "@/types/orderTracking";

export type OrderTrackingStatus =
  | "idle"
  | "connecting"
  | "tracking"
  | "terminal"
  | "error";

interface UseOrderTrackingResult {
  status: OrderTrackingStatus;
  state: TrackingState | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useOrderTracking(orderId: string): UseOrderTrackingResult {
  const [status, setStatus] = useState<OrderTrackingStatus>("idle");
  const [state, setState] = useState<TrackingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onmessage = null;
      sourceRef.current.onerror = null;
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const start = useCallback(() => {
    cleanup();
    setError(null);
    setStatus("connecting");

    const source = new EventSource(
      `${config.VITE_BACKEND_URL}/orders/${orderId}/track/stream`,
      { withCredentials: true },
    );
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "tracking" && parsed.data) {
          setState(parsed.data);
          if (parsed.data.isTerminal) {
            setStatus("terminal");
            cleanup();
            return;
          }
          setStatus("tracking");
        } else if (parsed.type === "error") {
          setError(parsed.message || "Tracking failed");
          setStatus("error");
          cleanup();
        } else if (parsed.type === "done") {
          setStatus((prev) =>
            prev === "tracking" ? prev : prev === "terminal" ? "terminal" : "idle",
          );
          cleanup();
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects on network errors; only surface terminal
      // errors from the server. Keep status unless it was explicitly closed.
      if (sourceRef.current === null) return;
    };
  }, [cleanup, orderId]);

  const stop = useCallback(() => {
    cleanup();
    setStatus("idle");
  }, [cleanup]);

  return { status, state, error, start, stop };
}