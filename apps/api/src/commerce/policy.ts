import { config } from "../config/env.js";
import { parseINR } from "./cart-snapshot.js";

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  actualAmount?: number;
}

export function checkSpendingLimit(amount: number): PolicyCheckResult {
  const limit = config.PIKO_MAX_ORDER_AMOUNT;
  if (amount > limit) {
    return {
      allowed: false,
      reason: `Order amount ₹${amount} exceeds the maximum allowed limit of ₹${limit}`,
      limit,
      actualAmount: amount,
    };
  }
  return { allowed: true, limit, actualAmount: amount };
}

export interface CartValidationResult {
  valid: boolean;
  reason?: string;
  warnings: string[];
}

export function validateCartForCheckout(cart: any): CartValidationResult {
  const warnings: string[] = [];

  if (!cart) {
    return { valid: false, reason: "Cart is empty or not found", warnings };
  }

  if (cart.cartAbsent) {
    return {
      valid: false,
      reason: cart.cartAbsentReason || "Cart not found",
      warnings,
    };
  }

  if (cart.addressWarning) {
    warnings.push(cart.addressWarning);
  }

  if (cart.cartWarning) {
    warnings.push(cart.cartWarning);
  }

  const unserviceable = cart.unserviceableItems || [];
  if (unserviceable.length > 0) {
    warnings.push(`${unserviceable.length} item(s) may not be serviceable`);
  }

  const items = cart.items || [];
  if (items.length === 0) {
    return { valid: false, reason: "Cart has no items", warnings };
  }

  const outOfStock = items.filter((i: any) => !i.isInStockAndAvailable);
  if (outOfStock.length > 0) {
    warnings.push(`${outOfStock.length} item(s) out of stock`);
  }

  const amount = parseINR(
    cart.billBreakdown?.toPay?.value || cart.cartTotalAmount || 0,
  );
  if (amount <= 0) {
    return { valid: false, reason: "Invalid cart amount", warnings };
  }

  const minOrder = 99;
  if (amount < minOrder) {
    warnings.push(`Minimum order amount is ₹${minOrder}`);
  }

  return { valid: true, warnings };
}

export interface AuthValidationResult {
  valid: boolean;
  reason?: string;
  authorization?: any;
}

export function validateAuthorization(
  auth: any,
  cartSnapshot: {
    hash: string;
    amount: number;
    addressId: string;
    paymentMethod: string;
  },
): AuthValidationResult {
  if (!auth) {
    return { valid: false, reason: "No checkout authorization found" };
  }

  if (auth.status !== "authorized") {
    return { valid: false, reason: `Authorization status is ${auth.status}` };
  }

  if (new Date() > new Date(auth.expiresAt)) {
    return { valid: false, reason: "Authorization has expired" };
  }

  if (auth.cartHash !== cartSnapshot.hash) {
    return { valid: false, reason: "Cart has changed since authorization" };
  }

  if (auth.amount !== cartSnapshot.amount) {
    return {
      valid: false,
      reason: "Cart amount has changed since authorization",
    };
  }

  if (auth.addressId !== cartSnapshot.addressId) {
    return {
      valid: false,
      reason: "Delivery address has changed since authorization",
    };
  }

  if (auth.paymentMethod !== cartSnapshot.paymentMethod) {
    return {
      valid: false,
      reason: "Payment method has changed since authorization",
    };
  }

  return { valid: true, authorization: auth };
}
