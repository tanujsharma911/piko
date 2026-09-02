import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2Icon,
  QrCodeIcon,
  SmartphoneIcon,
  CheckIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { cn } from "@/lib/utils";

export interface PaymentOrder {
  orderId: string;
  amount: number;
  kind?: "upi_qr" | "payment_failed";
  paasId?: string;
  bridgeUrl?: string;
  upiIntentUrl?: string;
  isQrFlow?: boolean;
  pollingIntervalInMs?: number;
  maxTimeToPollForInMs?: number;
}

interface PaymentModalProps {
  order: PaymentOrder | null;
  onSuccess: () => void;
  onClose: () => void;
}

const formatINR = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const UpiQrPayment = ({
  order,
  onConfirming,
  onDone,
}: {
  order: PaymentOrder;
  onConfirming: boolean;
  onDone: () => void;
}) => {
  const qrValue = order.upiIntentUrl || order.bridgeUrl;
  const isIntentQr = Boolean(order.upiIntentUrl);

  return (
    <>
      <div className="rounded-lg border bg-muted/40 p-4 text-center">
        <div className="font-heading text-3xl font-medium">
          {formatINR(order.amount)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Scan the UPI QR to pay for order
        </div>
        <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
          Order ID: #{order.orderId}
        </div>
        {qrValue ? (
          <div className="mt-5">
            <div className="flex justify-center">
              <QRCodeCanvas
                value={qrValue}
                size={256}
                marginSize={1}
                level="M"
              />
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {isIntentQr
                ? "Scan with any UPI app (GPay, PhonePe, Paytm, etc.)"
                : "Opens Swiggy payment QR"}
            </p>
          </div>
        ) : (
          <div className="flex h-80 w-full flex-col items-center justify-center gap-2 bg-background text-center">
            <QrCodeIcon className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No QR available — open your UPI app and pay{" "}
              {formatINR(order.amount)}.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {order.upiIntentUrl && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(order.upiIntentUrl, "_blank")}
          >
            <SmartphoneIcon className="size-4" />
            Open in UPI app
          </Button>
        )}
        {order.bridgeUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(order.bridgeUrl, "_blank")}
          >
            <ExternalLinkIcon className="size-4" />
            Open payment page in new tab
          </Button>
        )}
      </div>

      <DialogFooter className="flex justify-between">
        <Button
          onClick={onDone}
          disabled={onConfirming}
          className={cn(onConfirming && "cursor-progress")}
        >
          {onConfirming ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          I&apos;ve paid. Confirm order
        </Button>
      </DialogFooter>
    </>
  );
};

const PaymentFailed = ({ onClose }: { onClose: () => void }) => (
  <>
    <div className="rounded-lg border bg-destructive/5 p-4 text-center">
      <p className="text-sm font-medium text-destructive">
        Payment was not successful.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        No order was placed. You can retry from the chat.
      </p>
    </div>
    <DialogFooter>
      <Button onClick={onClose}>Close</Button>
    </DialogFooter>
  </>
);

const PaymentModal = ({ order, onSuccess, onClose }: PaymentModalProps) => {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirmUpi = () => {
    setIsConfirming(true);
    onSuccess();
  };

  const isUpiQr = order?.kind === "upi_qr";
  const isFailed = order?.kind === "payment_failed";

  return (
    <Dialog
      open={!!order}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isFailed ? "Payment failed" : "Complete your UPI payment"}
          </DialogTitle>
          <DialogDescription>
            {isFailed ? "Your payment could not be completed." : ""}
          </DialogDescription>
        </DialogHeader>

        {order && isUpiQr && (
          <UpiQrPayment
            order={order}
            onConfirming={isConfirming}
            onDone={handleConfirmUpi}
          />
        )}
        {order && isFailed && <PaymentFailed onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
};

export default PaymentModal;
