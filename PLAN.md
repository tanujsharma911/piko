# Piko — Instamart Live Order Tracking Implementation Plan

## Mission

Add live Swiggy Instamart order tracking to Piko without breaking the existing real checkout/order flow.

Users should be able to click **Track Order** and see:
- current order status
- ETA
- store location
- delivery location
- delivery partner/rider location when Swiggy provides it
- live map updates

The feature must survive refresh, stop polling at a terminal state, never auto-start from an old chat, keep the Swiggy token server-side, use Swiggy's `pollingIntervalSeconds`, and treat Swiggy as the source of truth.

## Critical rules

1. Do not refactor the working checkout/payment flow unnecessarily.
2. Do not use Gemini for continuous polling.
3. Do not invent coordinates, statuses, ETAs, terminal states, or polling intervals.
4. Use the exact data returned by `swiggy-instamart__track_order`.
5. Never expose the Swiggy access token to React.
6. Tracking is user-initiated. Opening an old conversation must not start a tracking loop.
7. Do not add Redis, Kafka, cron, workers, WebSockets, or a separate microservice for this feature unless the existing codebase already requires them.
8. Do not persist every rider GPS coordinate.

## 1. Investigate before coding

Before modifying anything, inspect:

1. Existing `get_addresses` implementation and actual response shape.
2. Where delivery-address coordinates are available.
3. Existing order persistence.
4. Where the order ID returned by checkout is stored.
5. Existing SSE implementation.
6. Existing React message/order-card architecture.
7. Existing audit implementation.
8. Existing Swiggy tool lookup.

Then make a real `track_order` call using an existing Instamart order.

Record the actual runtime response, especially:
- `mapInfo.riderLocation`
- `mapInfo.storeLocation`
- `mapInfo.deliveryLocation`
- `status.statusMessage`
- `status.subStatusMessage`
- `status.etaMinutes`
- `status.etaText`
- `pollingIntervalSeconds`
- the response when the order is delivered

Do not implement terminal-state detection from guesses. Use actual runtime behavior.

## 2. Exact Swiggy contract

`track_order` parameters:

```ts
{
  orderId: string;
  lat: number;
  lng: number;
}
```

Important response fields:

```ts
data: {
  orderId: string;
  orderTitle: string;
  orderSubtitle: string;
  status: {
    statusMessage: string;
    subStatusMessage?: string;
    etaMinutes?: number;
    etaText?: string;
  };
  storeInfo?: { name: string; address: string };
  deliveryInfo?: { addressLabel?: string; fullAddress: string };
  items: Array<{ name: string; quantity: number; price: string }>;
  itemCount: number;
  placedAt?: string;
  paymentInfo?: { message: string; amount?: string };
  mapInfo?: {
    storeLocation?: { latitude: number; longitude: number };
    storeAnnotation?: string;
    deliveryLocation?: { latitude: number; longitude: number };
    deliveryAnnotation?: string;
    riderLocation?: { latitude: number; longitude: number };
  };
  pollingIntervalSeconds: number;
}
```

On failure:

```ts
{
  success: false,
  error: { message: string }
}
```

## 3. Architecture

```text
User
  |
  | clicks Track Order
  v
React Tracking UI
  |
  | SSE
  v
Express Tracking Endpoint
  |
  v
Tracking Service
  |
  | authenticated MCP call
  v
swiggy-instamart__track_order
  |
  v
Swiggy
  |
  | latest state
  v
Tracking Service
  |
  | SSE event
  v
React
  |
  v
Live Map + ETA + Status
```

Gemini is not responsible for the polling loop.

## 4. Backend

Follow existing project conventions. Suggested files:

```text
apps/api/src/
  services/order-tracking.service.ts
  controllers/order-tracking.controller.ts
  routes/order-tracking.routes.ts
```

If the project uses different conventions, follow them.

The tracking service should:
1. obtain the authenticated user's Swiggy token;
2. obtain real delivery coordinates;
3. call `swiggy-instamart__track_order`;
4. normalize the response;
5. return `pollingIntervalSeconds`;
6. detect terminal state from actual Swiggy runtime behavior.

Suggested normalized state:

```ts
interface TrackingState {
  orderId: string;
  orderTitle?: string;
  orderSubtitle?: string;
  statusMessage: string;
  subStatusMessage?: string;
  etaMinutes?: number;
  etaText?: string;
  storeInfo?: { name: string; address: string };
  deliveryInfo?: { addressLabel?: string; fullAddress: string };
  storeLocation?: { latitude: number; longitude: number };
  deliveryLocation?: { latitude: number; longitude: number };
  riderLocation?: { latitude: number; longitude: number };
  pollingIntervalSeconds: number;
  isTerminal: boolean;
  updatedAt: string;
}
```

## 5. Tracking endpoint

Add an authenticated endpoint similar to:

```text
GET /orders/:orderId/track/stream
```

Before tracking:
1. verify Piko authentication;
2. verify order ownership;
3. verify Swiggy connection;
4. obtain required `lat`/`lng`;
5. fail gracefully if coordinates are unavailable;
6. never send the Swiggy token to the browser.

## 6. SSE lifecycle

On connection:

1. Immediately call `track_order`.
2. Send a tracking event.
3. If not terminal, wait exactly the returned `pollingIntervalSeconds`.
4. Call `track_order` again.
5. Repeat until terminal or disconnect.
6. On client disconnect, stop the polling loop and clean up timers.

Do not wait for the first interval before the initial fetch.

Event shape:

```ts
{
  type: "tracking",
  data: TrackingState
}
```

## 7. Refresh behavior

A browser refresh creates a new SSE connection.

```text
React mounts
  -> orderId available
  -> open NEW SSE
  -> backend immediately calls track_order
  -> latest Swiggy state
  -> render current map/status
```

Do not attempt to resume the old SSE connection.

## 8. Old conversation behavior — critical

Opening an old conversation must NOT automatically start tracking.

Correct:

```text
Open old chat
  -> show order card
  -> [ Track Order ]
  -> user clicks
  -> start SSE
```

If the order is already terminal/delivered:

```text
Open old chat
  -> show final status
  -> NO SSE
  -> NO polling
```

An order ID alone must never trigger automatic tracking.

## 9. Terminal behavior

When Swiggy indicates a terminal state using actual runtime data:

1. send the final state;
2. mark tracking terminal;
3. close SSE;
4. stop polling.

Do not hardcode a guessed status string.

## 10. React UI

Add a dedicated tracking card showing:
- order status
- ETA
- map
- rider marker when available
- store marker when available
- delivery marker when available
- last update time

Example:

```text
┌──────────────────────────────────────┐
│ 🚚 Instamart Order                   │
│ Order #247062610186087               │
│                                      │
│ 🟢 On the way                        │
│ Arriving in ~12 mins                 │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │       🏪                         │ │
│ │          \                       │ │
│ │           🚴                     │ │
│ │              \                   │ │
│ │               📍                 │ │
│ └──────────────────────────────────┘ │
│ Updated just now                     │
└──────────────────────────────────────┘
```

If `riderLocation` is absent, do not show a fake rider marker.

## 11. Map

Reuse an existing map library if available. Otherwise use a lightweight option such as Leaflet/React-Leaflet.

Components conceptually:

```text
TrackingMap
  ├── StoreMarker
  ├── RiderMarker
  └── DeliveryMarker
```

Use Swiggy coordinates directly. Do not geocode or invent coordinates.

Optional: smoothly animate the rider marker between the previous and new coordinates. Animation is presentation only.

## 12. Gemini integration

Gemini may help initiate tracking:

> Where is my order?

If no order ID is known, Gemini may use `get_orders` first. Once the order is known, the UI should start tracking directly where possible.

Do not make Gemini poll repeatedly.

## 13. Audit trail

The existing audit trail is already working. Do not rewrite it.

Do not flood the user-facing audit trail with every poll.

Prefer meaningful events such as:

```text
🚚 Live order tracking started
📍 Delivery partner location updated
📍 ETA updated to 12 min
📍 ETA updated to 7 min
✓ Order delivered
```

Raw polling logs may remain server-side if needed.

## 14. Security

Every tracking request must be scoped to the authenticated Piko user.

```text
authenticated?
  -> order belongs to user?
  -> Swiggy connection valid?
  -> coordinates available?
  -> track_order
```

Never allow one user to track another user's order.

Never send Swiggy tokens or Authorization headers to React.

## 15. Database

Do not create a GPS history database.

Do not persist every rider coordinate.

Reuse an existing order model if available.

Only persist minimal tracking state if genuinely needed, e.g.:

```ts
{
  userId,
  orderId,
  terminalState,
  lastTrackedAt
}
```

Swiggy remains authoritative for live state.

## 16. Duplicate tracking connections

If the user clicks Track Order twice, do not create duplicate SSE/polling loops.

Frontend:

```text
Track clicked
  -> already tracking?
      -> yes: do nothing
```

Backend must also clean up connections on disconnect.

## 17. Do not create permanent background tracking

If the browser/tab closes, stop that tracking session.

When the user returns later, they can click Track Order and Piko fetches the latest Swiggy state.

Do not create Redis/queue/cron infrastructure just to keep tracking while nobody is viewing it.

## 18. Implementation order

### Step 1 — Investigation
Inspect address coordinates, order persistence, checkout response, SSE, React architecture, audit system, and actual `track_order` response.

### Step 2 — Real tracking test
Use a real Instamart order and document actual location/status/ETA/interval/terminal behavior.

### Step 3 — Tracking service
Implement backend wrapper and normalizer.

### Step 4 — SSE endpoint
Implement auth, ownership, immediate first fetch, Swiggy interval, disconnect cleanup, and terminal stop.

### Step 5 — React tracking state
Use:

```text
IDLE
CONNECTING
TRACKING
TERMINAL
ERROR
```

### Step 6 — Tracking UI
Add status, ETA, map, and markers.

### Step 7 — Refresh
Verify reconnect + immediate fresh state.

### Step 8 — Terminal handling
Verify final state, SSE close, and polling stop.

### Step 9 — Old conversations
Verify reopening a conversation never automatically starts tracking.

### Step 10 — Audit
Add meaningful tracking events without poll spam.

### Step 11 — Testing
Run all acceptance tests below.

## 19. Required acceptance tests

### A — Start tracking
Active order -> click Track Order -> SSE connects -> track_order called -> UI appears.

### B — Live location
New Swiggy riderLocation -> SSE -> rider marker updates.

### C — ETA
Changed Swiggy ETA -> frontend updates.

### D — Refresh
Tracking -> refresh -> new SSE -> immediate track_order -> tracking resumes.

### E — Delivered
Terminal/delivered response -> final state -> SSE closes -> polling stops.

### F — Reopen old chat
Delivered order -> reopen conversation -> final state shown -> no automatic SSE/polling.

### G — Multiple clicks
Click Track Order twice -> only one active tracking stream.

### H — Unauthorized order
User A requests User B's order -> reject -> no Swiggy tracking call.

### I — Missing coordinates
No coordinates -> graceful error -> no fake coordinates.

### J — Swiggy error
track_order fails -> friendly error -> no false delivery/success claim.

## 20. Buildathon demo

```text
Real Instamart order
      ↓
Order confirmed
      ↓
[ Track Order ]
      ↓
Live map
      ↓
Rider location
      ↓
ETA updates
      ↓
Audit trail
      ↓
Terminal delivery state
      ↓
Tracking stops
```

The full Piko lifecycle is:

```text
DISCOVER
   ↓
CART
   ↓
AUTHORIZE
   ↓
PAY
   ↓
ORDER
   ↓
TRACK
   ↓
DELIVERED
```

## 21. Final report

When complete, report:
1. files created;
2. files modified;
3. tracking endpoint;
4. SSE event format;
5. how coordinates are obtained;
6. how terminal state is detected;
7. how refresh works;
8. how old conversations avoid polling;
9. how duplicate tracking connections are prevented;
10. acceptance-test results;
11. known limitations.

Do not claim completion until `track_order` has been tested with a real Instamart order.

## Core principle

**Gemini decides what the user wants. Piko controls the application flow. Swiggy is the source of truth for order and delivery state. React displays the live state.**
