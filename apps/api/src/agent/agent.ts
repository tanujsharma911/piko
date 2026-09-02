import type { IMessage } from "db";
import { config } from "../config/env.js";
import type { SSEEvent } from "./sse.js";
import { Tool } from "./tools.js";
import { checkSwiggyConnection } from "./swiggy/connection.js";
import {
  executeCheckout,
  handlePaymentStatus,
  type CheckoutContext,
} from "../commerce/checkout.service.js";

type OnEvent = (event: SSEEvent) => void;

function geminiUrl(model: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GOOGLE_API_KEY}`;
}

async function callGemini(
  contents: any[],
  tools?: any[],
  systemInstruction?: string,
  model?: string,
) {
  const body: any = { contents };
  if (tools) body.tools = tools;
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(geminiUrl(model || config.GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Gemini API error ${res.status}`;
    try {
      const err = await res.json();
      if (typeof err?.error?.message === "string") {
        message = `${message}: ${err.error.message}`;
      }
    } catch {
    }
    throw new Error(message);
  }

  return res.json();
}

async function emitTextAsStream(text: string, onEvent: OnEvent) {
  const words = text.split(/(\s+)/);
  let buffer = "";
  for (const word of words) {
    buffer += word;
    if (buffer.length >= 4 || word.includes("\n")) {
      onEvent({ type: "token", text: buffer });
      buffer = "";
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  if (buffer) {
    onEvent({ type: "token", text: buffer });
  }
}

const INSTAMART_SYSTEM_INSTRUCTION = `You are Piko, an AI shopping assistant for Swiggy Instamart ONLY.

Core principles:
- Piko is Instamart-only. Do not reference Food delivery or Dineout.
- NEVER invent real product names, prices, availability, or payment information.
- ALWAYS use live Swiggy data via the provided tools.
- Before any checkout, you MUST call get_cart to retrieve the live cart total, bill breakdown, delivery address, and available payment methods.
- Explain the final purchase to the user: items, quantities, line totals, subtotal, fees, discounts, final payable amount, delivery address, phone number, and payment method.
- Require explicit user authorization before proceeding to checkout.
- The backend policy layer (spending limit, cart validation, authorization) is the authoritative security boundary — you cannot bypass it.
- Do not call checkout or confirm_order merely because the user made a vague request like "place order" or "yes". Wait for explicit confirmation.
- Never claim checkout/order/payment success without tool confirmation.
- If checkout is blocked pending authorization, present the cart summary and wait for the user to authorize via the confirmation card.
- If checkout returns PENDING_PAYMENT with UPI QR, show the QR and wait for payment confirmation via the backend.
- When the user confirms payment, call confirm_order so the backend finalizes the order.
- Use exactly the payment method the user authorized — do not substitute another payment method.
- For COD, checkout completes the order directly.
- When mentioning any product, ALWAYS render its preview image directly beside the product title, using the exact imageUrl from the tool response as markdown image syntax: ![ProductName](imageUrl). Never mention a product without its image.
- When listing products (search results, cart items, or order summaries), ALWAYS present them in a markdown table with columns for the product image thumbnail, name, quantity, price, and total. One product per row.`;

const PROTECTED_TOOLS = new Set([
  "swiggy-instamart__checkout",
  "swiggy-instamart__confirm_order",
]);

async function handleProtectedTool(
  name: string,
  args: any,
  context: CheckoutContext,
  toolsByName: Map<string, any>,
): Promise<any> {
  if (name === "swiggy-instamart__checkout") {
    return executeCheckout(context, args.paymentMethod || "Cash", args.addressId);
  }

  if (name === "swiggy-instamart__confirm_order") {
    return handlePaymentStatus(context, args.orderId, args.paasId);
  }

  const matchedTool = toolsByName.get(name);
  if (!matchedTool) {
    return { error: `Tool "${name}" not found` };
  }
  return matchedTool.invoke(args);
}

export async function chat(
  userMessage: string,
  messages: IMessage[],
  userId: string,
  conversationId: string,
  onEvent?: OnEvent,
  model?: string,
) {
  const emit = onEvent || (() => {});

  const activeModel =
    model && /^gemini-[\w.-]+$/.test(model) ? model : config.GEMINI_MODEL;

  const { isSwiggyConnected, swiggyAccessToken } =
    await checkSwiggyConnection(userId);

  const groundingInstruction = isSwiggyConnected
    ? ""
    : `
IMPORTANT: The user's Swiggy account is NOT connected. You have NO
access to real restaurants, products, prices, availability, or carts.
You MUST NOT state specific product names, prices, or store names —
even ones that sound plausible. If asked about products, availability,
or anything requiring real Swiggy data, respond only with:
"I can't check that yet — you'll need to connect your Swiggy account
first." Do not guess or approximate real-world data under any
circumstances.
`;

  const systemInstruction = [INSTAMART_SYSTEM_INSTRUCTION, groundingInstruction]
    .filter(Boolean)
    .join("\n\n");

  const tools = new Tool();

  const { toolsByName, geminiTools } = await tools.getTools({
    isSwiggyConnected,
    swiggyAccessToken,
  });

  const contents: any[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const MAX_ITERATIONS = 10;
  let iterations = 0;

  const checkoutContext: CheckoutContext = {
    userId,
    conversationId,
    swiggyAccessToken,
    emit,
  };

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    emit({ type: "action", message: "Thinking", status: "pending" });

    const data = await callGemini(
      contents,
      geminiTools,
      systemInstruction,
      activeModel,
    );
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No candidate in Gemini response");

    const parts = candidate.content?.parts || [];
    contents.push({ role: "model", parts });

    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) {
      const textParts = parts.filter((p: any) => p.text);
      const fullText = textParts.map((p: any) => p.text).join("");
      await emitTextAsStream(fullText, emit);
      return fullText;
    }

    const functionResponses: any[] = [];

    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;

      const matchedTool = toolsByName.get(name);
      if (!matchedTool) {
        emit({
          type: "action",
          message: `Tool "${name}" not found`,
          toolName: name,
          status: "warning",
        });
        functionResponses.push({
          functionResponse: {
            name,
            response: { error: `Tool "${name}" not found` },
          },
        });
        continue;
      }

      let result: any;

      if (PROTECTED_TOOLS.has(name)) {
        try {
          result = await handleProtectedTool(name, args, checkoutContext, toolsByName);

          if (result?.success && result.paymentData) {
            emit({
              type: "action",
              message: `${name} initiated - payment required`,
              toolName: name,
              status: "done",
              kind: "CHECKOUT_AUTHORIZED",
              orderId: result.orderId,
              amount: result.paymentData.amount,
              response: result,
            });
          } else if (result?.success) {
            emit({
              type: "action",
              message: `${name} completed`,
              toolName: name,
              status: "done",
              kind: "ORDER_CONFIRMED",
              orderId: result.orderId,
              response: result,
            });
          } else {
            emit({
              type: "action",
              message: `${name} failed: ${result.error}`,
              toolName: name,
              status: "error",
              kind: result.status || "CHECKOUT_BLOCKED",
              response: result,
            });
          }
        } catch (err: any) {
          emit({
            type: "action",
            message: `${name} failed: ${err.message}`,
            toolName: name,
            status: "error",
            response: { error: err.message },
          });
          result = { error: err.message };
        }
      } else {
        try {
          result = await matchedTool.invoke(args as any);
          emit({
            type: "action",
            message: `${name} called`,
            toolName: name,
            status: "done",
            response: result,
          });
        } catch (err: any) {
          emit({
            type: "action",
            message: `${name} failed: ${err.message}`,
            toolName: name,
            status: "error",
            response: { error: err.message },
          });
          result = { error: err.message };
        }
      }

      functionResponses.push({
        functionResponse: { name, response: { result } },
      });
    }

    contents.push({ role: "user", parts: functionResponses });
  }

  throw new Error(
    "Tool-calling loop exceeded max iterations without a final answer",
  );
}

export async function generateTitle(userMessage: string): Promise<string> {
  const data = await callGemini([
    {
      role: "user",
      parts: [
        {
          text: `Summarize the following user message as a short chat title in 3-5 words. Only output the title, nothing else.\n\n"${userMessage}"`,
        },
      ],
    },
  ]);
  return data.candidates?.[0]?.content?.parts?.[0]?.text
    ?.trim()
    ?.replace(/^["']|["']$/g, "");
}