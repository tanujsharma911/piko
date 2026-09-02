import type { Response } from "express";

export interface SSEEvent {
  type: "action" | "token" | "done" | "error" | "payment" | "tracking";
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
  response?: any;
}

export function setSSEHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function sendSSEEvent(res: Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function sendSSEError(res: Response, message: string) {
  sendSSEEvent(res, { type: "error", message });
}

