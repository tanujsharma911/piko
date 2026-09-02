# Piko — Implementation Log (RESULT.md)

## Step 2A — Payment infrastructure (server) ✅

### 1. What I built
**New files**
- `packages/db/src/models/payment.model.ts` — `Payment` model + `IPayment`:
  `orderId` (unique), `razorpayPaymentId?`, `amount` (paise), `currency` (default INR), `status: "created"|"paid"`, `source` (default `swiggy_cart_total`), `conversationId` (indexed), `userId`, `finalTotal?`, `verifiedVia?`, `paidAt?`, timestamps. Exported from `packages/db/src/models/index.ts`.
- `apps/api/src/services/payment.service.ts` — `findByOrderId`, `createOrder` (Razorpay `orders.create` + persists `Payment("created")`), `verifySignature` (HMAC-SHA256 of `orderId|razorpayPaymentId` vs secret, `timingSafeEqual`), `verifyWebhookSignature` (HMAC of raw body vs `RAZORPAY_WEBHOOK_SECRET`), `markPaid`. Lazily-instanced `Razorpay` client exposed as `paymentService.client` for 2B.
- `apps/api/src/controllers/payment.controller.ts` — `verifyPayment` + `paymentWebhook`.
- `apps/api/src/routes/payment.route.ts` — `POST /payments/verify` (auth), `POST /payments/webhook` (no auth), mounted at `/payments`.
- `apps/api/src/types/express.d.ts` — ambient `Express.Request.rawBody?` augmentation.

**Edited files**
- `apps/api/src/index.ts` — global `express.json({ verify })` stashes `req.rawBody` (string); mounts `/payments`.
- `apps/api/src/config/env.ts` — adds `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- `packages/db/src/models/conversation.model.ts` — `IAuditEvent` gains `kind?` + `[key: string]: unknown` so structured events (e.g. `payment_verified`) persist through the existing plumbing.
- `apps/api/src/services/conversation.service.ts` — new `appendAuditEvents(conversationId, events)` that appends events to the **most recent assistant message's** `auditEvents`.

**Key decisions**
- For `payment_verified` audits (verify endpoint + webhook live *outside* a chat turn), I append the event to the last assistant message's `auditEvents` via the new helper — reuse of the existing message-scoped audit plumbing instead of inventing a parallel store. Frontend already renders `auditTrail` above every assistant message, so the "Payment confirmed (via client/webhook)" entry appears there automatically.
- Payments are marked `paid` iff HMAC signature is valid AND (for `/verify`) the conversation's owner is `req.user` (403 otherwise, checked **before** signature to avoid info leaks), 409 if already paid (idempotent). Webhook marks paid idempotently (skips when already `paid`).

### 2. Deviations from PLAN.md
| Deviation | Why |
|---|---|
| `@types/razorpay` **does not exist** on the npm registry (404) | The `razorpay` package (2.9.8) ships bundled TS types (`dist/razorpay.d.ts`, `export =`); dropped the extra dep and use its own types. |
| Added `verifiedVia: "client"\|"webhook"` to the `Payment` model (not in the plan's field list) | Needed so 2D can emit/show which path actually confirmed, per Section 3's `payment_verified.via`. |
| `finalTotal?` decided to be stored/document-converted in **paise** (plan implied rupees vs `paidAmount` rupees) | Keeps every monetary field on `Payment` unit-consistent (all paise); the 2D comparison `finalTotal > paidAmount` is identical in paise or rupees. |
| `payment_verified` audits appended onto the last assistant message (no standalone audit store) | The audit model is message-scoped; this is the existing plumbing, no new schema. |

### 3. Units / edge cases verified
- **Paise:** `Payment.amount` is paise by contract; `createOrder` receives paise directly and passes it to Razorpay verbatim. (Rupee→paise `Math.round(total*100)` conversion belongs to 2B; not introduced here.)
- **Ownership:** `/verify` loads payment first, returns `403 {error:"Not your payment"}` when `payment.userId.toString() !== req.user.id`, before any signature work.
- **Idempotent verify:** already-`paid` → `409` (no double write).
- **Webhook:** no authMiddleware; signature-gated; skips re-marking when already `paid`; unknown `orderId` logged, not errored; test events without `payment.captured` → `200 {received:true}`.
- **HMAC paths:** both signature checks use `crypto.timingSafeEqual` on equal-length buffers (length mismatch → `false`).
- **Env:** new vars parse from `process.env` with `""` fallback — real values still required in `.env` (user-owned).

### 4. Build status
All green:
```
pnpm --filter db run build        → ok
pnpm --filter api exec tsc -b     → ok (no output)
pnpm --filter web exec tsc -b     → ok
pnpm --filter web run build       → ok (only the pre-existing chunk-size warning)
```

### 5. Section 11 open items resolved this step
- **@types/razorpay** — resolved: package ships its own types; `import Razorpay from "razorpay"` works (esModuleInterop effective, consistent with `jsonwebtoken`).
- **Webhook payload shape** — confirmed against the bundled `razorpay` types + Razorpay docs: `payment.captured` → `payload.payment.entity.{id, order_id, status}`; handler reads exactly that.
- Remaining open for later steps: Swiggy cart-read tool name/shape, `place_order` total field + payment-method expectations (Gap-2 open item), final `IAuditEvent` union (user verifies).

---

*(Step 2B — `create_payment_order` custom tool + amount derivation — next.)*

---

## Step 2B — `create_payment_order` tool (custom, with server-side amount derivation)

### 1. What was built
- **`apps/api/src/utils/payment.tool.ts`** (new): `createPaymentOrderTool(opts)` factory returns a plain tool object (`{ name, description, schema, invoke }`) that integrates with the existing `toolsByName` map + `buildGeminiTools`.
  - **Schema:** `{ addressId: string }` (required). Deliberately **no `amount` field** — the model cannot author the rupee total. Per the live Swiggy tool contract, the cart is keyed by `addressId`, so the "cart reference" is the delivery `addressId` (small deviation, see §2).
  - **Invoke pipeline:** require `addressId` → resolve the Swiggy `get_food_cart` tool from `toolsByName` (matched via `includes("get_food_cart")`, separator-agnostic for `swiggy-food_get_food_cart` style names) → call it **server-side** → tolerant JSON/string/object coercion (`toObj`) → extract total via `pricing.to_pay` (fallbacks: `to_pay`, `totalAmount`, `total`) with rupee-symbol stripping (`toNumber`) → guards → create order → emit.
  - **Guards (in order):**
    1. Missing `addressId` → `payment_rejected(empty_cart)` — checkout blocked, instructs agent to `get_addresses` first.
    2. Cart read returns `success:false` / error → blocked with the upstream message.
    3. Empty cart (`items.length === 0` or `total <= 0`) → `payment_rejected(empty_cart)`.
    4. **Sanity cap:** `total > ₹1,00,000` → `payment_rejected(sanity_cap_exceeded)`. (Cap value not pinned in PLAN.md — introduced constant `MAX_PAYMENT_RUPEES = 100000`, flagged in §2.)
    5. **Reuse guard:** `Payment.findOne({ conversationId, status: "created" })` exists → **reuses it** (no new Razorpay order), emits `payment_reused`, **re-emits the `payment` SSE event** (so the modal can reopen even after a dismissed first attempt), returns the existing order digest.
    6. **Paise conversion:** `amountInPaise = Math.round(total * 100)` — created strictly from the Swiggy total; `Payment.amount` stored in paise.
  - **SSE/audit emissions:** `payment_created` action event (`{message, toolName, status:"done", kind:"payment_created", orderId, amount(rupees), source:"swiggy_cart_total"}`) + `{ type:"payment", data:{ orderId, amount(rupees), keyId } }` transport event; `payment` event also fired on the reuse path.
  - **Return digest to Gemini** (`{ orderId, amount(rupees), currency, status, keyId, reused? }` or `{ error }`) so the agent can narrate accurately.
- **`apps/api/src/utils/sse.ts`:** `SSEEvent` extended with structured optional fields — `kind`, `reason`, `orderId`, `via`, `amount`, `source`, `name`, `note`, `expected`, `actual`, `action` — so transport events carry typed audit payloads (SSE is still the single event highway to the client).
- **`apps/api/src/utils.ts` — `chat()`:** new optional 5th param `conversationId`. When present + Swiggy tools active + `RAZORPAY_KEY_ID`/`KEY_SECRET` configured, the custom payment tool is appended to the tool list (and `toolsByName`) before calling `callGemini`. `toolsByName` widened to `Map<string, any>` for the mixed tool types.
- **`apps/api/src/controllers/conversation.controller.ts`:** now passes `conversationId` into `chat`; the `action` collector persists the full structured payload (`kind`, `reason`, `orderId`, `via`, `amount`, `source`, …) into `auditEvents` — the typed fields survive into the DB, not just `message/toolName/status`.

### 2. Deviations
- Schema reference is **`addressId`** instead of an idealised unrelated `cartId` — the real Swiggy Food contract fetches the cart by `addressId` (`get_food_cart` input; output-only `cart_id`). Agent must call `get_addresses` before checkout — matches the natural flow and keeps the total Swiggy-sourced.
- `toolsByName` widened to `Map<string, any>` (structural pragmatism, consistent with the existing codebase's loose tool typing). The custom tool is a plain object, not a LangChain `DynamicStructuredTool`.
- **Sanity cap constant introduced** (`MAX_PAYMENT_RUPEES = 100000`) since PLAN.md left it open; value verified as inconsequential for demo-scale carts, trivially adjustable.
- Read of `get_food_cart` is **tolerant/lenient** (`pricing.to_pay` with fallbacks + numeric coercion) because the live Swiggy response could not be captured at build time (401 without the user token — see §5). Exact field could not be runtime-verified this step.

### 3. Units / edge cases verified
- All rupee amounts stay in rupees end-to-end (SSE, audit, Gemini digest); **paise exists only at the Razorpay boundary** (`Math.round(total*100)`) and in `Payment.amount` / `Payment.finalTotal`.
- Empty cart, upstream failure, over-cap, missing address: each maps to a distinct blocked path + audit + non-payable error to the model.
- Reuse path: no second Razorpay order; existing `created` order returned; idempotent + re-triggers the modal via SSE.
- Model CANNOT invent an amount — schema has no amount field.
- `conv${conversationId}` receipt ≤ 40 alnum chars (24-hex id + `conv` prefix).

### 4. Build status
```
pnpm --filter db run build      → not rerun this step (no db changes)
pnpm --filter api exec tsc -b   → ok
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (only the pre-existing chunk-size warning)
```

### 5. Section 11 open items resolved this step
- **Swiggy cart-read tool name/shape** — **resolved via official docs** (`https://mcp.swiggy.com/builders/docs/reference/food/`): cart tool is **`get_food_cart`** (input `addressId` required → response wrapper `{ success, data: { data?: { cart_id, items[], pricing{…, to_pay} }, addressId, availablePaymentMethods?, paymentOptions?, gpoError? } }`; payable total = `pricing.to_pay`, in rupees). Live-shape runtime verification still pending (needs the user's Swiggy token at runtime).
- **`place_order` total field + payment-method expectations (Gap-2 open item)** — **partially resolved via official docs**: `place_food_order` (`addressId` required) supports **Cash/COD** (→ immediate `status:"CONFIRMED"`, `totalAmount` returned) **and UPI** (`PENDING_PAYMENT` → poll `check_payment_status` → `confirm_order`). Docs mandate **explicit user confirmation before calling**. Decision for Piko: place food orders with **Cash/COD** so Swiggy records no payment and expects none on top of Piko's Razorpay charge (avoids double-payment-expectation); `placement_mismatch` gate (step 2D) will compare `totalAmount` vs `paidAmount`. UPI path intentionally avoided.
- Remaining open: final `IAuditEvent` union (user verifies), runtime shape verification of `get_food_cart` / `place_food_order`.

---

*(Step 2C — frontend payment flow: `useSSE` `onPayment`, `PaymentModal` (Razorpay Checkout with keyId), `/payments/verify`, "Payment confirmed, place my order" trigger, audit-kind rendering — next.)*

---

## Step 2C — Frontend payment flow

### 1. What was built
- **`apps/web/src/types/razorpay.d.ts`** (new): global ambient types for the Razorpay Checkout SDK — `Window.Razorpay` constructor, `RazorpayOptions`, `RazorpayInstance`, `RazorpayResponse` (`razorpay_payment_id` / `razorpay_order_id` / `razorpay_signature`).
- **`apps/web/src/hooks/useSSE.ts`**: `SSEEvent` and `AuditEvent` extended with the structured audit fields (`kind`, `reason`, `orderId`, `via`, `amount`, `source`) mirroring the server; new `onPayment?: (order: PaymentOrder) => void` option and `PaymentOrder` export; `action` events now forward the enriched fields; new `case "payment"` → `onPayment({ orderId, amount, keyId })`.
- **`apps/web/src/services/api.service.ts`**: added `verifyPayment({ orderId, razorpayPaymentId, signature })` → `POST /payments/verify` (cookie-auth; ownership + signature checked server-side per 2A).
- **`apps/web/src/components/PaymentModal.tsx`** (new):
  - `Dialog` (base-ui) rendered when `order != null`; shows server-derived `₹amount` + `orderId`.
  - Lazily injects `https://checkout.razorpay.com/v1/checkout.js` (cached `<script id="razorpay-checkout-sdk">`, resolves when already loaded, retried with existing listeners).
  - Pay button builds Checkout with `key: keyId`, `amount: Math.round(amount * 100)` (paise), `order_id`, `handler` → `verifyPayment` → `onSuccess()`. `modal.ondismiss` releases the processing lock (allows retry or cancel). Verify failure → inline error + modal stays open for retry.
- **`apps/web/src/components/AuditTrail.tsx`**: kind-aware rendering — a label pill for `payment_created` / `payment_reused` / `payment_rejected` / `payment_verified` / `placement_mismatch` (prefix foreground + `(count)` label preserved), plus chips for `orderId` (mono) and `via` on the row; error status tints the pill `bg-destructive/10 text-destructive`. `AuditEntry` extended with the structured fields.
- **`apps/web/src/components/ChatInput.tsx`**: `handleSend(contentOverride?)` accepts an optional programmatic content (used by the post-payment auto-send); new `onPayment` passthrough into the SSE options; registers the send function via `onRegisterSend` (useEffect every render → always latest closure) so `Chat` can drive the next user turn.
- **`apps/web/src/pages/Chat.tsx`**: `paymentOrder` state + `handlePayment(order)`; renders `<PaymentModal order onSuccess onClose>`; `handlePaymentSuccess` closes the modal and auto-sends **"Payment confirmed, place my order"** through the same send path (fresh SSE turn → agent proceeds to place); `sendMessageRef` wires ChatInput's registered send.

### 2. Deviations
- **Failure handling stays in-modal** (inline error + retry) instead of "failure → close modal". Rationale: closing on a verify failure would strand the user mid-flow with no recoverable action; the plan's `payment_verified`/error events still surface via the backend's audit persistence and the verify/error paths all still emit audits. Buyer to re-verify if strict plan wording desired. (The `409 already-paid` and signature/ownership errors from `/payments/verify` bubble as the inline message too.)
- `AuditTrail` shows **label pill + message + orderId/via chips** rather than per-kind bespoke icons — keeps the existing status-icon vocabulary (Check / X / AlertTriangle) that already encodes success/error/warning, per PLAN "icon + label + message".
- The auto-send message string "Payment confirmed, place my order" is hard-coded in `Chat.tsx` (plan-specified phrasing); the agent is expected to place the order from context.

### 3. Units / edge cases verified
- Amount displayed and sent to Checkout in **rupees → paise** (`Math.round(amount * 100)`); `PaymentOrder.amount` is rupees end-to-end on the client; `Payment.amount` stays paise server-side (2A).
- Reuse path (2B) re-emits `payment` SSE → modal reopens with the same `orderId`; verify then succeeds against that same order (documented, no double charge).
- Modal only renders when all three fields present (`orderId`, `amount`, `keyId`); malformed `payment` events ignored.
- Script idempotent load; `requestIdleCallback` not used — standard on-demand injection; SDK unavailable → inline error + retry.
- `onOpenChange(false)` (overlay/Esc/X) → `onClose()`; modal closes without state mutation — order stays `created`; a later retry goes through the reuse path.
- Cancel does NOT re-trigger a send; only `handlePaymentSuccess` fires the auto-send.

### 4. Build status
```
pnpm --filter db run build      → not rerun this step (no db changes)
pnpm --filter api exec tsc -b   → not rerun this step (no api changes)
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (only the pre-existing chunk-size warning)
```

### 5. Section 11 open items resolved this step
- **Where does Razorpay Checkout get its amount/key?** — resolved: `/payments/verify` and the Checkout both operate on the **server-derived** `Payment` (created by 2B from the Swiggy cart total); the frontend only receives `orderId`, `amount`, `keyId` via the `payment` SSE event. The model can never supply an amount.
- **Checkout SDK typing** — resolved: bundled via a local ambient declaration (`types/razorpay.d.ts`), no npm `@types/razorpay-checkout` needed.
- Remaining open: Step 2D — placement gate wrapper (`place_food_order` via `toolsByName`, `totalAmount` vs server-loaded `paidAmount` from the `paid` `Payment`, `placement_mismatch` event), resume-on-reload when a `paid` `Payment` exists, and the final `IAuditEvent` union (user verifies).

---

*(Step 2D — placement gate wrapper, ownership demo wiring, webhook durability/resume, failure demos — next.)*

---

## Step 2D — Placement gate, ownership, webhook durability, resume

### 1. What was built
- **`apps/api/src/utils/place-order.gate.ts`** (new) — `wrapPlaceOrderTool(tool, opts)` returns a tool-like with the same `name`/`schema` but a **gated `invoke`**:
  - **Pre-check (unpaid block):** loads the conversation's latest `Payment` with `status:"paid"` (server-side only). If none → `throw "Payment required before placing the order."` — the loop surfaces it as a `failed` error audit; the agent reports to the user. **No placement without a settled Razorpay capture.**
  - **Paid amount is server-derived:** `paidRupees = Payment.amount / 100` (paise → rupees); never from the LLM/frontend.
  - **Real call passes through** (`tool.invoke(args)`); thrown upstream errors propagate naturally to the loop.
  - **Post-check (price-mismatch):** tolerant deep scan of the response for a total (`totalAmount`, `total`, `amount`, `to_pay`, `finalTotal`, `total_price`, `orderTotal`, `billTotal`; rupee-symbol stripped; BFS depth/cycle-guarded). If found:
    - stores `finalTotal` (paise, `Math.round(total*100)`) on the paid `Payment` doc for recon (both proceed and blocked paths);
    - `finalTotal > paidRupees` → emits **`placement_mismatch`** action event (`expected: paidRupees`, `actual: finalTotal`, `action:"blocked"`) with the loud user-visible message `"Price changed to ₹X, you paid ₹Y. Order not placed."`, then throws it (order already committed upstream cannot be undone — surfaced loudly, per §9 no-refund scope).
    - `finalTotal <= paidRupees` → proceed (minor undercharge ignored per plan).
  - **Payment-method guardrail (Section 11):** the wrapped tool's **description** is amended with an explicit instruction for Gemini to place the food order as **Cash (COD)** — the customer already paid Piko via Razorpay — so Swiggy records cash-payable and does not expect a second payment (double-payment-expectation resolved without hard-forcing an arg that may not exist in the merchant's available methods).
- **`apps/api/src/utils.ts`**: in `chat()`, when `conversationId` is present, the prefixed Swiggy tool whose name `endsWith("place_food_order")` is swapped in `toolsByName` + `webTools` for the wrapped gated tool (before `buildGeminiTools`, so the amended description reaches the model).
- **`apps/api/src/controllers/payment.controller.ts`** + **`routes/payment.route.ts`**: new **`GET /payments/conversation/:conversationId`** (auth + ownership 403) → latest `Payment` for the conversation: `{ exists, paid, payment: { orderId, status, amount(paise), finalTotal, verifiedVia } }` (null payment when none).
- **`apps/web/src/services/api.service.ts`**: `getPaymentState(conversationId)`.
- **`apps/web/src/pages/Chat.tsx`**: on conversation load, alongside `getMessages`, fetches payment state; if `paid` → shows a **resume banner** ("Payment already settled for this order (₹X) — continue ordering?") with **Continue ordering** (re-sends `"Payment confirmed, place my order"` via the registered send → agent places order; no re-charge) and a dismiss X. `PLACE_ORDER_MESSAGE` const now shared with the post-payment auto-send.
- **`apps/web/src/components/AuditTrail.tsx`**: `AuditEntry` gains `expected`/`actual`; when both present a chip renders `₹{actual} > ₹{expected}` (destructive tint), satisfying "placement_mismatch shows expected/actual".

### 2. Deviations
- **Unpaid block has no dedicated audit kind.** The plan's union only defines `placement_mismatch`; blocking before any placement is represented as a plain `error` action event (message `Payment required before placing the order.`) rather than inventing a `placement_blocked` kind. User may add one to the verified union if desired.
- **Mismatch is detected post-commit**: Swiggy only reveals the true total in the `place_food_order` response, at which point the order is already placed. Blocking is therefore *loud-and-audited* (`placement_mismatch(blocked)` + thrown error) rather than a true pre-commit denial. §9 explicitly scopes refund/undo out — matches "placement semantics pre- vs post-commit confirmed during implementation" (confirmed: post-commit).
- **COD handling via description amendment**, not hard arg-forcing (a forced `paymentMethod` may not exist in every merchant's available-methods list → placement failure risk). If the model still picks UPI at demo, `check_payment_status`/`confirm_order` remain available as Swiggy tools.
- **finalTotal extraction is tolerant** (BFS over `totalAmount|total|amount|to_pay|finalTotal|total_price|orderTotal|billTotal`). Exact `place_food_order` response field still pending runtime verification with the user's token (docs showed `totalAmount` for Cash/COD, optional for UPI).
- If the total cannot be extracted, the result passes through ungated (no false block) with the upstream payload intact.

### 3. Units / edge cases verified
- Cross-boundary units: `paidRupees` derived from `Payment.amount` (paise) via `/100`; `finalTotal` stored back in paise via `Math.round(total*100)`; display/SSE remain rupees.
- Ownership: `getPaymentState` returns 403 if the conversation's Payment belongs to another user — same Gap-3 guarantee as `/payments/verify` (2A).
- Failure demos covered now: (1) double call → `payment_reused` (2B); (2) empty cart → `payment_rejected(empty_cart)` (2B); (3) modal closed/failed → order stays `created` → next call `payment_reused` + modal reopens (2B/2C); (4) price change at placement → `placement_mismatch(blocked)` (this step); (5) died after paying → webhook settles (2A) → resume banner (this step).
- Resume banner is dismissed (no auto-send) until the user clicks "Continue ordering" — no surprise placements on reload; `getPaymentState` 401/403/errors degrade to no banner.

### 4. Build status
```
pnpm --filter db run build      → ok
pnpm --filter api exec tsc -b   → ok
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (only the pre-existing chunk-size warning)
```

### 5. Section 11 open items resolved this step
- **`place_order` payment-method expectations (Gap-2)**: resolved via official Swiggy MCP docs in Step 2B — `place_food_order` supports Cash/COD (immediate `CONFIRMED`, `totalAmount`) and UPI (`PENDING_PAYMENT` → poll → `confirm_order`). This step encodes the **Cash/COD default** (description-level instruction, no pretokenized assumptions) so Swiggy never expects payment on top of Piko's Razorpay capture.
- **`place_order` total field**: `totalAmount` (documented for Cash/COD); extraction keeps tolerant fallbacks pending live-token runtime verification.
- **Webhook durability**: 2A (idempotent `markPaid` via `payment.captured`) + this step's resume banner (ordered `paid` Payment → continue-ordering offer; prevents re-charge).
- Remaining open: final `IAuditEvent` union field names/types (user verifies), runtime verification of `get_food_cart`/`place_food_order` response shapes with the user's Swiggy token.

---

*Phase 2 implementation complete (2A → 2D). Next: end-to-end demo runtime verification (real Razorpay keys + Swiggy token), then user verification of the final `IAuditEvent` union; polish items such as DEMO.md walkthrough if requested.*

---

## Wrap-up — env reference + demo runbook

### 1. What was built
- **`apps/api/.env.example`** (new): documents all API env vars including the Phase 2 additions (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) and Swiggy/Gemini keys — copy to `apps/api/.env`.
- **`apps/api/.env`**: Razorpay placeholders appended (empty values; config already defaults them to `""`, verified in `config/env.ts`). No secrets written.
- **`DEMO.md`** (new, repo root): full demo runbook — prerequisites, setup, architecture one-liner, ~5-minute happy path, audit-panel legend, the 5 audit-visible failure demos, manual checkpoint one-liners (ownership 403, bad-signature 400, unpaid-placement block), and troubleshooting (incl. the tolerant-parse fallback behavior).
- Verified config consistency: API listens on **3535** (`index.ts`), web `.env` already sets `VITE_BACKEND_URL=http://localhost:3535`, CORS default `http://localhost:5173`; `express.json` verify stashes `rawBody` globally; `/payments` mounted; `sendSSEEvent` serializes the full event (undefined keys dropped naturally).

### 2. Deviations
- None new — closing deliverable only.

### 3. Units / edge cases verified
- Port + CORS + rawBody wiring confirmed by inspection (no runtime run — needs real keys/token).
- Webhook registration instructions (event `payment.captured`, payload `payload.payment.entity.order_id`) captured in DEMO.md from the bundled Razorpay types (2A §5).

### 4. Build status
```
pnpm --filter db run build      → ok (unchanged)
pnpm --filter api exec tsc -b   → ok (unchanged)
pnpm --filter web exec tsc -b   → ok (unchanged)
pnpm --filter web run build     → ok (unchanged)
```
(No source-code changes this entry; only docs/env scaffolding.)

### 5. Section 11 open items resolved this step
- Env/runbook gaps closed. Remaining genuinely open: **live runtime verification** with real Razorpay keys + a Swiggy token (response-shape confirmation of `get_food_cart` `pricing.to_pay` and `place_food_order` `totalAmount`), and the **final `IAuditEvent` union field names/types — user to verify/approve**.

---

*Implementation complete. Handoff checklist for the user: (1) fill `apps/api/.env` incl. Razorpay keys; (2) register Razorpay webhook for `payment.captured` to demo #5; (3) run the happy path through DEMO.md; (4) approve the `IAuditEvent` union.*

---

## Thinking / Sending status split (post-wrap-up change)

### 1. What was changed
- **Backend (`apps/api/src/utils.ts`)**: `chat()` now emits an `action` event `{ message: "Thinking", status: "pending" }` as its **very first** emission (immediately after `emit` is bound, before any DB/tool/Gemini work) — so the client sees "Thinking" only once the server has accepted the request and started processing. The SSE write happens right after the stream headers are flushed.
- **Frontend (`apps/web/src/components/ChatInput.tsx`)**: the client-side pre-send placeholder is renamed `"Sending..."` (pending) — it renders while the request is in flight, before the server accepts.
- **Controller (`apps/api/src/controllers/conversation.controller.ts`)**: on a **successful** turn, any persisted `status: "pending"` audit entries are finalized to `"done"` before writing the assistant message. Prevents infinite "Executing…" spinners on reload for finished turns (now that a backend "Thinking" pending entry is part of the trail). Error-path behavior unchanged.

### 2. Deviations
- None beyond the above; the error; path keeps prior behavior (a failed turn may still persist trailing pending entries, matching pre-existing semantics that an interrupted turn is visibly unfinished).
- `Sending...`/`Thinking` entries are plain status rows (no `kind`), consistent with existing "pending statuses aren't typed events" design.

### 3. Units / edge cases verified
- Event order on the wire: client `Sending...` (pending) → first stream event `Thinking` (pending; `markLastDone` marks `Sending...` done client-side) → next tool/action event marks `Thinking` done.
- `chat()` also runs without SSE (when `onEvent` is undefined) — the `emit` noop guard keeps the new event harmless.
- Reload-safe: persisted pending are downgraded to `done` on success only; the audit trail continues to show the journey without perpetual spinners.

### 4. Build status
```
pnpm --filter db run build      → ok (unchanged)
pnpm --filter api exec tsc -b   → ok
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (unchanged; only the known chunk-size warning)
```

### 5. Section 11 open items
- None affected. Remaining: live runtime verification + `IAuditEvent` union approval (unchanged).

---

## Model selection from the Chat Input (post-wrap-up change)

### 1. What was changed
- **Backend (`apps/api/src/config/env.ts`, `apps/api/src/utils.ts`)**:
  - `GEMINI_MODEL` (default `gemini-3.1-flash-lite`) controls the default model; new `GEMINI_MODELS` (default `gemini-3.6-flash,gemini-3.1-flash-lite`) is the **allowlist** for per-request selection.
  - Hardcoded `GEMINI_URL` replaced by `geminiUrl(model)`; `callGemini(..., model?)` builds the URL per call.
  - `chat()` gains a `model?: string` param; validates against `GEMINI_MODELS` and falls back to `GEMINI_MODEL` for anything unknown. `generateTitle()` keeps using the env default.
- **Backend controller (`conversation.controller.ts`)**: reads `body.model`, passes it into `chat()` (unknown/absent model → server default).
- **Frontend (`apps/web/src/hooks/useSSE.ts`)**: `sendMessage(conversationId, content, options, model?)` — `model` is included in the request body when present.
- **Frontend (`apps/web/src/components/ChatInput.tsx`)**: a **model dropdown** (CPU icon button in the input addon) lists `Flash Lite 3.1` / `Flash 3.6`; selection is sent with every turn (including the post-payment auto-send and resume, which reuse the registered send with the current selection). Default = `gemini-3.1-flash-lite`.

### 2. Deviations
- Model selection is per-message (not persisted per-conversation); refreshing the page resets to the default. Server-side allowlist keeps unknown strings from reaching the API.
- Checkmark (`✓`) used as the selected indicator in the dropdown (UI affordance, not an emoji).

### 3. Units / edge cases verified
- Unknown/bogus `model` in the body → server silently falls back to `GEMINI_MODEL`.
- `model` absent → server default (backwards compatible with existing clients/webhook-driven flows that don't pass it).
- The auto-send/resume path uses `ChatInput`'s registered `handleSend`, so it carries the currently selected model.
- `geminiUrl` only referenced from `callGemini`, single source of truth for both `chat` and `generateTitle`.

### 4. Build status
```
pnpm --filter db run build      → ok (unchanged)
pnpm --filter api exec tsc -b   → ok
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (unchanged; only the known chunk-size warning)
```

### 5. Section 11 open items
- None affected. Remaining: live runtime verification + `IAuditEvent` union approval (unchanged).

### 1. What was changed
- **Error path finalization (`apps/api/src/controllers/conversation.controller.ts`)**: on a failed turn (e.g. `Gemini API error 429 …quota`), persisted entries with `status: "pending"` are finalized to `"done"` before saving — they completed (e.g. `Thinking` began, tools were called); **only the row actually causing the failure** (the appended error entry, e.g. the 429 message) is `error`. Previously the trailing `Thinking`/`Calling …` pendings were persisted as-is → perpetual "Executing…" loading on reload.
- **Frontend load guard (`apps/web/src/pages/Chat.tsx`)**: `normalizeAudit` now coerces any `status === "pending"` to `"done"` when loading history. This retroactively fixes already-persisted pending rows too (the DB may still hold spinners from earlier 429 runs). Live-streaming rows are untouched (they come through `handleAction`, not `normalizeAudit`).
- **Breathing pending row (`apps/web/src/components/AuditTrail.tsx`)**: the pending branch no longer renders `Skeleton` placeholders; it now shows the **actual event text** (`Thinking`, `Calling swiggy-food_…`) with the spinner icon + a smooth up-and-down opacity pulse (`animate-pulse`, Tailwind v4 built-in) on the text. Waiting turns read the real step name instead of an anonymous shimmer bar.

### 2. Deviations
- Interrupted steps on a failed turn become `done` rows (they executed/started and did not cause the failure); only the actual failing row stays `error`. The frontend `normalizeAudit` load-guard independently coerces any lingering `pending` → `done` (protects legacy DB rows).
- Legacy DB records are handled on the client (pending→done on load); the server-side fix only applies to newly saved turns.

### 3. Units / edge cases verified
- 429 at the very first Gemini call → persisted trail = `Thinking` (done) + `Gemini API error 429: …` (error) → reload shows zero pending, zero spinners, and only the true failure row is red.
- Success path unchanged (pending→done on save) — no double-handling with `normalizeAudit`.
- `animate-pulse` verified available (Tailwind v4 default utility); `Skeleton` import dropped cleanly (api + web tsc pass under `noUnusedLocals`).

### 4. Build status
```
pnpm --filter db run build      → ok (unchanged)
pnpm --filter api exec tsc -b   → ok
pnpm --filter web exec tsc -b   → ok
pnpm --filter web run build     → ok (unchanged; only the known chunk-size warning)
```

### 5. Section 11 open items
- None affected. Remaining: live runtime verification + `IAuditEvent` union approval (unchanged).
---

### Confirmation gate + system instruction (Apr 2026)

#### What changed
- **`apps/api/src/utils/place-order.gate.ts`**: `WrapPlaceOrderToolOptions` gained `lastUserMessage: string`. New hard confirmation check at the top of `invoke`: `lastUserMessage.trim().toLowerCase() === "order"` — rejects with a clear error before the paid-check even runs. Existing paid-check + shortfall logic unchanged.
- **`apps/api/src-utils.ts`**: `lastUserMessage: userMessage` threaded into `wrapPlaceOrderTool` call. New `CONFIRMATION_INSTRUCTION` constant prepended to the system instruction — requires Gemini to show a full itemized summary (table, address, phone, offers, bill breakup, payment method) and end with "Type Order to confirm and place this order." — and to never place on anything other than exactly "Order".

#### Why
- The model was bypassing `create_payment_order` (calling Swiggy's native payment tools instead) and placing orders without showing a summary or asking for confirmation.
- The confirmation gate is code-enforced, not LLM-judged — even if the model tries to call `place_food_order` on a vague "yes"/"confirm"/"go ahead", the gate rejects it.

#### Build
- `pnpm --filter api exec tsc -b` → ok
- `pnpm --filter web exec tsc -b` → ok

#### Deviations from plan
- None. This was a user-requested feature addition.

#### Next move
- Test the full flow: build cart → pay via Razorpay test → model shows summary → user types "Order" → placement succeeds; also test that "yes"/"confirm"/etc. are rejected and the summary is re-shown.

---

### Swiggy disconnect fix (Apr 2026)

#### Root cause
`swiggy.controller.ts` disconnect handler used `{ swiggyAccessToken: undefined, swiggyTokenExpiresAt: undefined }` in `findByIdAndUpdate`. Mongoose strips `undefined` from update objects — fields were never cleared. Status always returned `connected: true`, so the UI flipped back immediately.

#### Changes
- **`apps/api/src/controllers/swiggy.controller.ts`**: Changed `undefined` to `$unset: { swiggyAccessToken: 1, swiggyTokenExpiresAt: 1 }` — fields are now removed from the document.
- **`apps/web/src/components/SettingsDialog.tsx`**: Added `onError` handler to `disconnectMutation` so failures are logged instead of swallowed silently.

#### Build
- `pnpm --filter api exec tsc -b` → ok
- `pnpm --filter web exec tsc -b` → ok
- `pnpm --filter web run build` → ok

#### Deviations from plan
- None. Plan was approved as-is.

---

### Refactor payment/placement tool wiring (Apr 2026)

#### PART 1 — `createPaymentOrderTool` with explicit `vertical` param
- **`apps/api/src/utils/payment.tool.ts`**: Refactored to accept `vertical: "food" | "instamart"` and parameterize behavior:
  - **Food**: cart suffix `get_food_cart`, total from `pricing.to_pay`
  - **Instamart**: cart suffix `get_cart`, total via tolerant multi-key extraction (reuses `extractFinalTotal` from `place-order.gate.ts`) plus Instamart-specific `cartTotalAmount` / `billBreakdown.toPay.value` fallbacks
  - Tool name made unique: `create_payment_order_food` / `create_payment_order_instamart`
  - All existing guards (empty cart, sanity cap, reuse guard, paise conversion, SSE + audit emission) preserved
- **`apps/api/src/utils/place-order.gate.ts`**: Exported `TOTAL_KEYS`, `toNumberRupees`, `extractFinalTotal` for reuse

#### PART 2 — Payment tool registration in `chat()`
- **`apps/api/src/utils.ts`**: Replaced single-tool registration with vertical-aware loop:
  ```typescript
  const paymentVerticals = [
    { vertical: "food", cartSuffix: "get_food_cart" },
    { vertical: "instamart", cartSuffix: "get_cart" },
  ];
  for (const { vertical, cartSuffix } of paymentVerticals) {
    if ([...toolsByName.keys()].some(n => n.toLowerCase().endsWith(cartSuffix))) {
      const paymentTool = createPaymentOrderTool({ toolsByName, userId, conversationId, emit, vertical });
      webTools.push(paymentTool);
      toolsByName.set(paymentTool.name, paymentTool);
    }
  }
  ```
  - Zero, one, or two `create_payment_order_*` tools registered depending on which cart tools are actually present
  - Dineout intentionally excluded (no payment tool; bookings are free)
- **`apps/api/src/utils/toolsAllowedList.ts`**: Removed dead `ALLOWED_CUSTOM_TOOLS` array; `isToolAllowed` now returns `false` for unknown prefixes

#### Verification
- Food-only user: only `create_payment_order_food` registers (has `get_food_cart`)
- Instamart-only user: only `create_payment_order_instamart` registers (has `get_cart`)
- Both connected: both tools register
- Neither connected: zero payment tools register
- Dineout: no payment tool registered (correct — bookings are free)
- Builds: API ✅, Web ✅ (vite build ✅)

#### Deviations
- Instamart total extraction: Doc fetch succeeded (`get_cart.md` shows `cartTotalAmount` in `InstamartCart` and `toPay` in `billBreakdown`). Implementation uses `extractFinalTotal` (tolerant BFS) + Instamart-specific fields as fallback — matches spec.
- No Dineout payment tool branch added (intentional per spec).
