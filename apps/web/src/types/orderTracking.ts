export interface TrackingLocation {
  latitude: number;
  longitude: number;
}

export interface ConversationOrder {
  orderId: string;
  paymentMethod: string;
  amount: number | null;
  paidVia?: string | null;
  internalStatus?: string | null;
  placedAt: string;
  authorizedAt?: string | null;
  consumedAt?: string | null;
  updatedAt?: string | null;
  isTerminal: boolean;
  terminalState: string | null;
  lastStatusText: string | null;
  lastTrackedAt: string | null;
  lifecycle?: OrderLifecycleSnapshot | null;
}

export interface OrderLifecycleSnapshot {
  delivered: boolean;
  cancelled: boolean;
  statusText: string | null;
  etaText: string | null;
  deliveryBy: number | null;
  serverNow: number | null;
}

export interface TrackingState {
  orderId: string;
  orderTitle?: string;
  orderSubtitle?: string;
  statusMessage: string;
  subStatusMessage?: string;
  statusText?: string;
  etaMinutes?: number;
  etaText?: string;
  deliveryBy?: number;
  serverNow?: number;
  storeInfo?: { name: string; address: string };
  deliveryInfo?: { addressLabel?: string; fullAddress: string };
  itemCount?: number;
  items?: Array<{ name: string; quantity: number; price: string }>;
  placedAt?: string;
  storeLocation?: TrackingLocation;
  deliveryLocation?: TrackingLocation;
  riderLocation?: TrackingLocation;
  pollingIntervalSeconds: number;
  isTerminal: boolean;
  terminalState?: string;
  source: "track_order" | "delivery_status";
  updatedAt: string;
}

export interface OrderTrackingEvent {
  type: "tracking" | "error" | "done";
  data?: any;
  message?: string;
}