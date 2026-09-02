import { config } from "../config/env.js";
import { Order } from "db";
import { computeCartHash, extractPayableAmount, extractAddressId, extractCartId } from "./cart-snapshot.js";
import { checkSpendingLimit, validateCartForCheckout, validateAuthorization } from "./policy.js";
import type { SSEEvent } from "../agent/sse.js";
import { getSwiggyInstaMartTools } from "../agent/swiggy/instamart/tools.js";

type OnEvent = (event: SSEEvent) => void;

export function unwrapToolResult(value: any): any {
  if (value == null) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fallthrough: text may contain embedded JSON
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // not JSON after all
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    // MCP content parts: [{ type: "text", text }, ...]. Pick the last block
    // that parses as JSON (the real payload is usually the final block).
    let lastJson: any;
    for (const part of value) {
      const text =
        part && typeof part === "object" && part.type === "text" &&
        typeof part.text === "string"
          ? part.text
          : null;
      if (text == null) continue;
      const unwrapped = unwrapToolResult(text);
      if (unwrapped != null && typeof unwrapped === "object") {
        lastJson = unwrapped;
      }
    }
    if (lastJson !== undefined) return lastJson;
    return value;
  }

  if (typeof value === "object") {
    if ("success" in value && "data" in value) {
      return unwrapToolResult(value.data);
    }
    return value;
  }

  return value;
}

export interface CheckoutContext {
  userId: string;
  conversationId: string;
  swiggyAccessToken: string;
  emit?: OnEvent;
}

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  status?: string;
  paymentMethod?: string;
  message?: string;
  error?: string;
  authRequired?: boolean;
  paymentData?: {
    paasId: string;
    orderId: string;
    bridgeUrl?: string;
    upiIntentUrl?: string;
    isQrFlow: boolean;
    pollingIntervalInMs: number;
    maxTimeToPollForInMs: number;
    amount?: number;
  };
}

export interface AuthorizationData {
  cartId: string;
  cartHash: string;
  amount: number;
  addressId: string;
  paymentMethod: string;
}

export const SUPPORTED_PAYMENT_METHODS = ["UPI", "Cash", "COD"] as const;

export function normalizePaymentMethod(paymentMethod?: string): string {
  const raw = (paymentMethod || "Cash").trim();
  if (!SUPPORTED_PAYMENT_METHODS.includes(raw as any)) {
    return "Cash";
  }
  return raw === "COD" ? "Cash" : raw;
}

interface LiveCartResult {
  cart: any;
  toolsByName: Map<string, any>;
  error?: string;
}

async function fetchLiveCart(swiggyAccessToken: string): Promise<LiveCartResult> {
  const tools = await getSwiggyInstaMartTools(swiggyAccessToken);
  const toolsByName = new Map(tools.map((t: any) => [t.name, t]));

  const getCartTool = toolsByName.get("swiggy-instamart__get_cart");
  if (!getCartTool) {
    return { cart: null, toolsByName, error: "get_cart tool not available" };
  }

  const cartResult = await getCartTool.invoke({});
  const cart = unwrapToolResult(cartResult);

  if (!cart) {
    return { cart: null, toolsByName, error: "Failed to retrieve cart" };
  }

  return { cart, toolsByName };
}

function extractPaymentMethods(cart: any): string[] {
  const methods: string[] = [];

  const paymentOptions = cart.paymentOptions || cart.availablePaymentMethods || [];
  if (Array.isArray(paymentOptions)) {
    for (const po of paymentOptions) {
      const id = typeof po === "string" ? po : po?.id || po?.methodName || po?.displayName;
      if (id) methods.push(String(id));
    }
  }

  const hasCod = methods.some((m) => /cash|cod/i.test(m)) || cart?.paymentOptions?.cod?.available === true;
  const hasUpi = methods.some((m) => /upi/i.test(m));

  if (hasUpi) methods.unshift("UPI");
  if (hasCod) methods.unshift("Cash");

  return [...new Set(methods)].slice(0, 4);
}

export async function createCheckoutAuthorization(
  context: CheckoutContext,
  authorizationData: AuthorizationData,
): Promise<{ authorization: any; error?: string }> {
  const { userId, conversationId } = context;

  const existing = await Order.findOne({
    userId,
    swiggyOrderId: null,
    status: "authorized",
  }).sort({ createdAt: -1 });

  if (existing) {
    await Order.updateOne(
      { _id: existing._id },
      { status: "cancelled", updatedAt: new Date() },
    );
  }

  const expiresAt = new Date(Date.now() + config.CHECKOUT_AUTH_EXPIRY_MINUTES * 60 * 1000);

  const authorization = await Order.create({
    userId,
    conversationId,
    cartId: authorizationData.cartId,
    cartHash: authorizationData.cartHash,
    amount: authorizationData.amount,
    addressId: authorizationData.addressId,
    paymentMethod: authorizationData.paymentMethod,
    status: "authorized",
    authorizedAt: new Date(),
    expiresAt,
  });

  return { authorization };
}

export async function getActiveAuthorization(
  userId: string,
  conversationId: string,
) {
  return Order.findOne({
    userId,
    conversationId,
    status: "authorized",
  }).sort({ createdAt: -1 });
}

export async function getLatestConsumedAuthorization(
  userId: string,
  conversationId: string,
) {
  return Order.findOne({
    userId,
    conversationId,
    status: "consumed",
  }).sort({ createdAt: -1 });
}

export async function getLatestInFlightAuthorization(
  userId: string,
  conversationId: string,
) {
  return Order.findOne({
    userId,
    conversationId,
    status: { $in: ["payment_pending", "consumed"] },
  }).sort({ createdAt: -1 });
}

export async function consumeAuthorization(authorizationId: string) {
  return Order.updateOne(
    { _id: authorizationId },
    { status: "consumed", consumedAt: new Date() },
  );
}

export async function authorizeCheckout(
  context: CheckoutContext,
  paymentMethodInput?: string,
): Promise<{ success: boolean; authorization?: any; cartSnapshot?: any; error?: string }> {
  const { swiggyAccessToken } = context;
  const emit = context.emit || (() => {});
  const paymentMethod = normalizePaymentMethod(paymentMethodInput);

  emit({ type: "action", message: "Checking your live cart", status: "pending", kind: "CHECKING_CART" });

  const { cart, error } = await fetchLiveCart(swiggyAccessToken);
  if (error || !cart) {
    emit({ type: "action", message: error || "Cart unavailable", status: "error" });
    return { success: false, error: error || "Cart unavailable" };
  }

  const validation = validateCartForCheckout(cart);
  if (!validation.valid) {
    emit({ type: "action", message: validation.reason || "Cart not valid", status: "error" });
    return { success: false, error: validation.reason || "Cart not valid" };
  }

  const amount = extractPayableAmount(cart);
  const limitCheck = checkSpendingLimit(amount);
  if (!limitCheck.allowed) {
    emit({ type: "action", message: limitCheck.reason || "Spending limit exceeded", status: "error", kind: "CHECKOUT_BLOCKED" });
    return { success: false, error: limitCheck.reason || "Spending limit exceeded" };
  }

  const addressId = extractAddressId(cart);
  if (!addressId) {
    return { success: false, error: "No delivery address available" };
  }

  const cartId = extractCartId(cart);
  if (!cartId) {
    return { success: false, error: "Cart ID not found" };
  }

  const cartHash = computeCartHash(cart);

  const result = await createCheckoutAuthorization(context, {
    cartId,
    cartHash,
    amount,
    addressId,
    paymentMethod,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    authorization: result.authorization,
    cartSnapshot: { cartId, cartHash, amount, addressId, paymentMethod, items: cart.items },
  };
}

export async function executeCheckout(
  context: CheckoutContext,
  paymentMethodInput?: string,
  addressIdArg?: string,
): Promise<CheckoutResult> {
  const { userId, conversationId, swiggyAccessToken } = context;
  const emit = context.emit || (() => {});
  const paymentMethod = normalizePaymentMethod(paymentMethodInput);

  emit({ type: "action", message: "Fetching live cart for checkout", status: "pending", kind: "CHECKING_CART" });

  const { cart, toolsByName, error } = await fetchLiveCart(swiggyAccessToken);
  if (error || !cart) {
    emit({ type: "action", message: error || "Cart unavailable", status: "error", kind: "CHECKOUT_BLOCKED" });
    return { success: false, error: error || "Cart unavailable" };
  }

  const validation = validateCartForCheckout(cart);
  if (!validation.valid) {
    for (const w of validation.warnings) {
      emit({ type: "action", message: w, status: "warning" });
    }
    emit({ type: "action", message: validation.reason || "Cart not valid", status: "error", kind: "CHECKOUT_BLOCKED" });
    return { success: false, error: validation.reason || "Cart not valid" };
  }

  const amount = extractPayableAmount(cart);
  const limitCheck = checkSpendingLimit(amount);
  if (!limitCheck.allowed) {
    emit({ type: "action", message: limitCheck.reason || "Spending limit exceeded", status: "error", kind: "CHECKOUT_BLOCKED" });
    return { success: false, error: limitCheck.reason || "Spending limit exceeded" };
  }

  const finalAddressId = addressIdArg || extractAddressId(cart);
  if (!finalAddressId) {
    return { success: false, error: "No delivery address available" };
  }

  const cartId = extractCartId(cart);
  if (!cartId) {
    return { success: false, error: "Cart ID not found" };
  }

  const cartHash = computeCartHash(cart);

  const auth = await getActiveAuthorization(userId, conversationId);
  const authValidation = validateAuthorization(auth, { hash: cartHash, amount, addressId: finalAddressId, paymentMethod });

  // No valid authorization (or cart changed after it was granted) →
  // surface the confirmation request to the frontend + ask Gemini to present the summary.
  if (!authValidation.valid) {
    const paymentMethods = extractPaymentMethods(cart);

    emit({
      type: "action",
      message: "Checkout requires your explicit authorization",
      status: "pending",
      kind: "CHECKOUT_AUTHORIZATION_REQUESTED",
      amount,
      data: {
        cart: {
          cartId,
          amount,
          addressId: finalAddressId,
          addressLabel: cart.selectedAddressDetails?.address || cart.selectedAddress?.addressLine || "",
          paymentMethod,
          paymentMethods,
          items: (cart.items || []).map((i: any) => ({
            spinId: i.spinId,
            skuId: i.skuId,
            itemName: i.itemName,
            itemVariant: i.itemVariant,
            quantity: i.quantity,
            imageUrl: i.imageUrl,
            mrp: i.mrp,
            discountedFinalPrice: i.discountedFinalPrice || i.finalPrice,
          })),
        },
        reason: authValidation.reason,
      },
    });

    return {
      success: false,
      error: authValidation.reason || "",
      authRequired: true,
    };
  }

  // Atomic transition → double clicks / retries cannot fire a second checkout.
  // The auth is marked "payment_pending" while checkout is in-flight (a UPI QR
  // may be shown). It is only upgraded to "consumed" once Swiggy actually
  // confirms the order on payment success. A hard checkout failure reverts
  // the auth back to "authorized" so a genuine retry remains possible.
  if (!auth) {
    return { success: false, error: "No checkout authorization found" };
  }

  const inFlight = await Order.findOneAndUpdate(
    { _id: auth._id, status: "authorized" },
    { status: "payment_pending", consumedAt: new Date() },
    { new: true },
  );

  if (!inFlight) {
    emit({ type: "action", message: "Checkout already initiated for this authorization", status: "warning", kind: "CHECKOUT_BLOCKED" });
    return { success: false, error: "Checkout already initiated for this authorization" };
  }

  emit({ type: "action", message: "Cart validated, placing your order with Swiggy", status: "pending", kind: "CHECKOUT_STARTED" });

  const checkoutTool = toolsByName.get("swiggy-instamart__checkout");
  if (!checkoutTool) {
    await Order.updateOne(
      { _id: inFlight._id },
      { status: "authorized", consumedAt: undefined, updatedAt: new Date() },
    );
    return { success: false, error: "checkout tool not available" };
  }

  const checkoutArgs: any = {
    addressId: finalAddressId,
    paymentMethod,
  };

  if (paymentMethod === "UPI") {
    checkoutArgs.generateUPIQR = true;
  }

  let checkoutData: any;
  try {
    const checkoutResult = await checkoutTool.invoke(checkoutArgs);
    checkoutData = unwrapToolResult(checkoutResult);
  } catch (err: any) {
    await Order.updateOne(
      { _id: inFlight._id },
      { status: "authorized", consumedAt: undefined, updatedAt: new Date() },
    );
    emit({ type: "action", message: `Checkout failed: ${err.message}`, status: "error", kind: "CHECKOUT_FAILED" });
    return { success: false, error: err.message || "Checkout failed" };
  }

  if (!checkoutData) {
    return { success: false, error: "Checkout returned no data" };
  }

  if (checkoutData.status === "PENDING_PAYMENT" || checkoutData.isQrFlow) {
    await Order.updateOne(
      { _id: inFlight._id },
      { swiggyOrderId: checkoutData.orderId, swiggyPaasId: checkoutData.paasId },
    );

    emit({
      type: "payment",
      message: "UPI payment required",
      data: {
        kind: "upi_qr",
        orderId: checkoutData.orderId,
        paasId: checkoutData.paasId,
        bridgeUrl: checkoutData.bridgeUrl,
        upiIntentUrl: checkoutData.upiIntentUrl,
        isQrFlow: checkoutData.isQrFlow,
        pollingIntervalInMs: checkoutData.pollingIntervalInMs,
        maxTimeToPollForInMs: checkoutData.maxTimeToPollForInMs,
        amount,
      },
    });

    return {
      success: true,
      orderId: checkoutData.orderId,
      status: "PENDING_PAYMENT",
      paymentMethod,
      message: "Scan the QR code to complete payment",
      paymentData: {
        paasId: checkoutData.paasId,
        orderId: checkoutData.orderId,
        bridgeUrl: checkoutData.bridgeUrl,
        upiIntentUrl: checkoutData.upiIntentUrl,
        isQrFlow: checkoutData.isQrFlow,
        pollingIntervalInMs: checkoutData.pollingIntervalInMs || 3000,
        maxTimeToPollForInMs: checkoutData.maxTimeToPollForInMs || 120000,
        amount,
      },
    };
  }

  if (checkoutData.status === "CONFIRMED" || paymentMethod === "Cash" || paymentMethod === "COD") {
    emit({ type: "action", message: "Order placed successfully", status: "done", kind: "ORDER_CONFIRMED" });

    const orders = checkoutData.orders || [{ ...checkoutData }];
    const successCount = orders.filter((o: any) => o.status === "CONFIRMED" || o.status === "PLACED").length;
    const placedOrderId = checkoutData.orderId || orders[0]?.orderId || "";

    // The order is genuinely placed with Swiggy now — upgrade payment_pending → consumed.
    if (placedOrderId) {
      await Order.updateOne(
        { _id: inFlight._id },
        {
          status: "consumed",
          consumedAt: new Date(),
          swiggyOrderId: placedOrderId,
        },
      );
    } else {
      await Order.updateOne(
        { _id: inFlight._id },
        { status: "consumed", consumedAt: new Date() },
      );
    }

    return {
      success: true,
      orderId: placedOrderId,
      status: "CONFIRMED",
      paymentMethod,
      message: successCount > 1
        ? `Multi-store order: ${successCount}/${orders.length} orders placed`
        : "Instamart order placed successfully",
    };
  }

  return {
    success: false,
    error: `Unexpected checkout status: ${checkoutData.status}`,
  };
}

export async function handlePaymentStatus(
  context: CheckoutContext,
  orderId?: string,
  paasId?: string,
  maxPolls = 20,
): Promise<CheckoutResult> {
  const { userId, conversationId, swiggyAccessToken } = context;
  const emit = context.emit || (() => {});

  // Prefer persisted identifiers from the checkout phase.
  const inFlight = await getLatestInFlightAuthorization(userId, conversationId);
  const resolvedOrderId = orderId || inFlight?.swiggyOrderId;
  const resolvedPaasId = paasId || inFlight?.swiggyPaasId;

  if (!resolvedOrderId || !resolvedPaasId) {
    return { success: false, error: "No active checkout/payment identifiers found" };
  }

  const tools = await getSwiggyInstaMartTools(swiggyAccessToken);
  const toolsByName = new Map(tools.map((t: any) => [t.name, t]));

  const checkPaymentTool = toolsByName.get("swiggy-instamart__check_payment_status");
  if (!checkPaymentTool) {
    return { success: false, error: "check_payment_status tool not available" };
  }

  const confirmOrderTool = toolsByName.get("swiggy-instamart__confirm_order");

  emit({ type: "action", message: "Checking payment status", status: "pending", kind: "PAYMENT_PENDING" });

  let polls = 0;
  let lastStatus = "";

  while (polls < maxPolls) {
    polls++;

    const paymentResult = await checkPaymentTool.invoke({ paasId: resolvedPaasId, orderId: resolvedOrderId });
    const paymentData = unwrapToolResult(paymentResult);

    if (!paymentData) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const isTerminal = paymentData.terminal === true;
    const isSuccess = paymentData.isTerminalSuccess === true;
    const isFailure = paymentData.isTerminalFailure === true;
    const alreadyConfirmed = paymentData.confirmed === true;

    if (lastStatus !== paymentData.status) {
      lastStatus = paymentData.status || "";
      emit({ type: "action", message: `Payment status: ${lastStatus}`, status: "pending", kind: "PAYMENT_PENDING" });
    }

    if (isTerminal) {
      if (isFailure) {
        if (inFlight) {
          await Order.updateOne(
            { _id: inFlight._id },
            { status: "cancelled", consumedAt: undefined, updatedAt: new Date() },
          );
        }
        emit({ type: "payment", message: "Payment failed", status: "error", data: { kind: "payment_failed", orderId: resolvedOrderId, paasId: resolvedPaasId } });
        emit({ type: "action", message: "Payment failed — no order was placed", status: "error", kind: "PAYMENT_FAILED" });
        return { success: false, error: "Payment failed", orderId: resolvedOrderId, status: "PAYMENT_FAILED" };
      }

      if (isSuccess) {
        if (inFlight && inFlight.status === "payment_pending") {
          await Order.updateOne(
            { _id: inFlight._id },
            { status: "consumed", consumedAt: new Date(), updatedAt: new Date() },
          );
        }
        if (alreadyConfirmed) {
          emit({ type: "action", message: "Order confirmed automatically", status: "done", kind: "ORDER_CONFIRMED" });
          return { success: true, orderId: resolvedOrderId, status: "CONFIRMED", message: "Order confirmed" };
        }

        if (confirmOrderTool) {
          emit({ type: "action", message: "Confirming order after successful payment", status: "pending", kind: "CHECKOUT_STARTED" });

          const confirmResult = await confirmOrderTool.invoke({ orderId: resolvedOrderId, paasId: resolvedPaasId });
          const confirmData = unwrapToolResult(confirmResult);

          if (confirmData?.result === "success") {
            emit({ type: "action", message: "Order confirmed", status: "done", kind: "ORDER_CONFIRMED" });
            return { success: true, orderId: resolvedOrderId, status: "CONFIRMED", message: "Order confirmed after payment" };
          }

          return { success: false, error: "Order confirmation failed", orderId: resolvedOrderId };
        }

        return { success: true, orderId: resolvedOrderId, status: "CONFIRMED", message: "Payment successful, order auto-confirmed" };
      }
    }

    const interval = paymentData.pollingIntervalInMs || 3000;
    await new Promise((r) => setTimeout(r, interval));
  }

  return { success: false, error: "Payment still pending — timed out waiting", orderId: resolvedOrderId };
}