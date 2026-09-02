import { createHash } from "crypto";

export function parseINR(value: any): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const digits = String(value).replace(/[^\d.-]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export interface CartSnapshot {
  cartId: string;
  hash: string;
  amount: number;
  addressId: string;
  paymentMethod: string;
  items: Array<{
    spinId: string;
    skuId: string;
    quantity: number;
    finalPrice: number;
  }>;
}

function normalizeCartForHash(cart: any): CartSnapshot {
  const items = (cart.items || []).map((item: any) => ({
    spinId: item.spinId || item.skuId,
    skuId: item.skuId,
    quantity: item.quantity || 0,
    finalPrice: Number(item.discountedFinalPrice || item.finalPrice || item.price || 0),
  }));

  items.sort((a: any, b: any) => (a.spinId || a.skuId).localeCompare(b.spinId || b.skuId));

  return {
    cartId: cart.cartId || "",
    hash: "",
    amount: parseINR(cart.billBreakdown?.toPay?.value || cart.cartTotalAmount || 0),
    addressId: extractAddressId(cart),
    paymentMethod: "",
    items,
  };
}

export function computeCartHash(cart: any): string {
  const normalized = normalizeCartForHash(cart);
  const payload = JSON.stringify({
    cartId: normalized.cartId,
    amount: normalized.amount,
    addressId: normalized.addressId,
    items: normalized.items,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function createCartSnapshot(cart: any, paymentMethod: string): CartSnapshot {
  const normalized = normalizeCartForHash(cart);
  return {
    ...normalized,
    paymentMethod,
    hash: computeCartHash(cart),
  };
}

export function extractPayableAmount(cart: any): number {
  return parseINR(cart.billBreakdown?.toPay?.value || cart.cartTotalAmount || 0);
}

export function extractAddressId(cart: any): string {
  if (typeof cart.selectedAddress === "string") return cart.selectedAddress;
  return (
    cart.selectedAddressId ||
    cart.selectedAddress?.id ||
    cart.selectedAddressDetails?.id ||
    ""
  );
}

export function extractCartId(cart: any): string {
  return cart.cartId || "";
}