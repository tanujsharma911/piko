import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Loader2Icon, ShieldCheckIcon, XIcon, CheckIcon } from "lucide-react";

export interface CheckoutItem {
  spinId: string;
  skuId: string;
  itemName: string;
  itemVariant: string;
  quantity: number;
  imageUrl: string;
  mrp: number;
  discountedFinalPrice: number;
}

export interface PendingCheckout {
  cartId: string;
  amount: number;
  addressId: string;
  addressLabel: string;
  paymentMethod: string;
  paymentMethods: string[];
  items: CheckoutItem[];
}

const formatINR = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const METHOD_LABELS: Record<string, string> = {
  UPI: "UPI",
  Cash: "Cash on Delivery",
  COD: "Cash on Delivery",
};

const CheckoutCard = ({
  checkout,
  isConfirming,
  error,
  onConfirm,
  onCancel,
}: {
  checkout: PendingCheckout;
  isConfirming: boolean;
  error: string | null;
  onConfirm: (paymentMethod: string) => void;
  onCancel: () => void;
}) => {
  const [paymentMethod, setPaymentMethod] = useState<string>(
    checkout.paymentMethods?.includes(checkout.paymentMethod)
      ? checkout.paymentMethod
      : checkout.paymentMethods?.[0] || "UPI",
  );

  const itemTotal =
    checkout.items?.reduce(
      (sum, item) =>
        sum + (item.discountedFinalPrice || item.mrp || 0) * item.quantity,
      0,
    ) || 0;

  return (
    <motion.div
      className="mb-2 w-full origin-top"
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 10 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="flex items-center gap-2 text-sm font-medium px-2">
          <ShieldCheckIcon className="size-4 text-emerald-600" />
          Confirm &amp; Pay
        </div>
        <Button
          variant="secondary"
          size="icon-sm"
          onClick={onCancel}
          disabled={isConfirming}
          aria-label="Dismiss checkout"
        >
          <XIcon />
        </Button>
      </div>

      <div className="max-h-56 overflow-y-auto px-4 py-3">
        {checkout.items?.length ? (
          <ul className="space-y-2">
            {checkout.items.map((item, i) => (
              <li
                key={`${item.spinId}-${i}`}
                className="flex items-center gap-3 text-sm"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.itemName}
                    className="size-10 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <div className="size-10 shrink-0 rounded-lg border bg-muted/40" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.itemName}</div>
                  {item.itemVariant && (
                    <div className="truncate text-xs text-muted-foreground">
                      {item.itemVariant}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Qty {item.quantity}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatINR(
                    (item.discountedFinalPrice || item.mrp || 0) *
                      item.quantity,
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Cart is empty.</p>
        )}
        {checkout.addressLabel ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Delivering to:{" "}
            <span className="font-medium text-foreground">
              {checkout.addressLabel}
            </span>
          </p>
        ) : null}
      </div>

      <div className="border-t px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Order total</span>
          <span className="font-heading text-lg font-medium">
            {formatINR(checkout.amount || itemTotal)}
          </span>
        </div>

        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Select payment method
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(checkout.paymentMethods?.length
            ? checkout.paymentMethods
            : ["UPI", "Cash"]
          ).map((method) => {
            const selected = paymentMethod === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                disabled={isConfirming}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  selected
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-zinc-200 bg-white text-foreground hover:bg-muted/40"
                }`}
              >
                {/* Marker */}
                <span
                  className={`flex size-5 items-center justify-center rounded-full border-2 transition-all duration-300 ease-out ${
                    selected
                      ? "border-emerald-600 bg-emerald-600"
                      : "border-muted-foreground/40 bg-transparent"
                  }`}
                >
                  <CheckIcon
                    className={`size-3 transition-all duration-300 ease-out ${
                      selected
                        ? "text-white opacity-100 scale-100"
                        : "text-emerald-600 opacity-0 scale-0"
                    }`}
                    strokeWidth={3}
                  />
                </span>

                {/* Label */}
                <span
                  className={`font-medium transition-colors ${
                    selected ? "text-emerald-700" : ""
                  }`}
                >
                  {METHOD_LABELS[method] || method}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <Button
          className="w-full"
          onClick={() => onConfirm(paymentMethod)}
          disabled={isConfirming}
        >
          {isConfirming ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ShieldCheckIcon className="size-4" />
          )}
          {isConfirming
            ? "Authorizing..."
            : `Confirm & Pay ${formatINR(checkout.amount || itemTotal)}`}
        </Button>
      </div>
    </motion.div>
  );
};

export default CheckoutCard;
