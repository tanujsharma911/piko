import { config } from "@/config/env";

interface SSEEvent {
  type: "action" | "token" | "done" | "error" | "payment";
  message?: string;
  text?: string;
  data?: any;
  toolName?: string;
  status?: "pending" | "done" | "error" | "warning";
  kind?: string;
  reason?: string;
  orderId?: string;
  via?: string;
  amount?: number;
  source?: string;
  name?: string;
  note?: string;
  expected?: number;
  actual?: number;
  action?: string;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  keyId?: string;
  kind?: "upi_qr" | "payment_failed";
  paasId?: string;
  bridgeUrl?: string;
  upiIntentUrl?: string;
  isQrFlow?: boolean;
  pollingIntervalInMs?: number;
  maxTimeToPollForInMs?: number;
}

export interface AuditEvent {
  message: string;
  toolName?: string;
  status?: "pending" | "done" | "error" | "warning";
  kind?: string;
  reason?: string;
  orderId?: string;
  via?: string;
  amount?: number;
  source?: string;
  data?: any;
}

interface UseSSEOptions {
  onAction?: (event: AuditEvent) => void;
  onToken?: (text: string) => void;
  onDone?: (data: any) => void;
  onError?: (event: AuditEvent) => void;
  onPayment?: (order: PaymentOrder) => void;
}

export function useSSE() {
  const sendMessage = async (
    conversationId: string,
    content: string,
    options: UseSSEOptions,
    model?: string,
  ) => {
    const res = await fetch(
      `${config.VITE_BACKEND_URL}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          content,
          role: "user",
          ...(model ? { model } : {}),
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`SSE request failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    let textAccumulator = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        try {
          const event: SSEEvent = JSON.parse(line.slice(6));

          switch (event.type) {
            case "action":
              options.onAction?.({
                message: event.message || "",
                toolName: event.toolName,
                status: event.status,
                kind: event.kind,
                reason: event.reason,
                orderId: event.orderId,
                via: event.via,
                amount: event.amount,
                source: event.source,
                data: event.data,
              });
              break;
            case "payment":
              if (event.data) {
                options.onPayment?.({
                  orderId: event.data.orderId,
                  amount: event.data.amount,
                  kind: event.data.kind,
                  paasId: event.data.paasId,
                  bridgeUrl: event.data.bridgeUrl,
                  upiIntentUrl: event.data.upiIntentUrl,
                  isQrFlow: event.data.isQrFlow,
                  pollingIntervalInMs: event.data.pollingIntervalInMs,
                  maxTimeToPollForInMs: event.data.maxTimeToPollForInMs,
                });
              }
              break;
            case "token":
              textAccumulator += event.text || "";
              options.onToken?.(event.text || "");
              break;
            case "done":
              if (textAccumulator) {
                console.log("Piko Audit Event:", {
                  type: "text",
                  text: textAccumulator,
                });
                textAccumulator = "";
              }
              options.onDone?.(event.data);
              return;
            case "error":
              options.onError?.({
                message: event.message || "Unknown error",
                toolName: event.toolName,
                status: "error",
              });
              return;
          }
        } catch {
          // skip malformed events
        }
      }
    }

    if (textAccumulator) {
      console.log("Piko Audit Event:", { type: "text", text: textAccumulator });
      textAccumulator = "";
    }
  };

  return { sendMessage };
}
