import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Param = {
  name: string;
  type: string;
  required?: boolean;
  desc?: string;
};

type Tool = {
  name: string;
  params: Param[];
  returns: string;
  note?: string;
};

type ToolGroup = {
  key: string;
  server: string;
  title: string;
  blurb: string;
  tools: Tool[];
};

const GROUPS: ToolGroup[] = [
  {
    key: "swiggy-instamart",
    server: "Instamart",
    title: "Swiggy Instamart",
    blurb: "Grocery / essentials discovery, cart, checkout, orders and delivery tracking.",
    tools: [
      {
        name: "get_addresses",
        params: [
          { name: "page", type: "number", desc: "1-based, default 1" },
          { name: "pageSize", type: "number", desc: "default 10, max 10" },
        ],
        returns: "addresses[{ id, addressLine, phoneNumber, addressCategory?, addressTag? }], pagination",
        note: "Source of truth for addressId used by the cart and checkout.",
      },
      {
        name: "create_address",
        params: [
          { name: "fullAddress", type: "string", required: true },
          { name: "addressLine", type: "string", required: true, desc: "main street / building" },
          { name: "addressLine2", type: "string", required: true, desc: "apt/floor/wing" },
          { name: "city", type: "string", required: true },
          { name: "postalCode", type: "string", required: true },
          { name: "addressCategory", type: "HOME | WORK | OFFICE | FRIENDS_AND_FAMILY | OTHER", required: true },
          { name: "userName", type: "string", required: true },
          { name: "userPhone", type: "string", required: true },
          { name: "locality", type: "string" },
          { name: "latitude", type: "number", desc: "auto-resolved if omitted" },
          { name: "longitude", type: "number", desc: "auto-resolved if omitted" },
          { name: "addressTag", type: "string" },
          { name: "receiverName", type: "string", desc: "if delivering to someone else" },
          { name: "receiverPhone", type: "string" },
        ],
        returns: "addressId",
        note: "The agent must auto-parse fullAddress into the structured fields — never ask for them separately.",
      },
      {
        name: "delete_address",
        params: [{ name: "addressId", type: "string", required: true }],
        returns: "statusCode, statusMessage",
        note: "Permanent — always confirm with the user first.",
      },
      {
        name: "search_products",
        params: [
          { name: "addressId", type: "string", required: true, desc: "from get_addresses" },
          { name: "query", type: "string", required: true, desc: "product name, category or brand" },
          { name: "offset", type: "number" },
        ],
        returns:
          "products[{ displayName, brand, inStock, productId, parentProductId, variations[{ spinId, skuId, quantityDescription, price{ mrp, offerPrice }, isInStockAndAvailable, rating, sla, maxQuantity }] }], nextOffset, similarProducts?",
        note: "Always search before adding.",
      },
      {
        name: "your_go_to_items",
        params: [
          { name: "addressId", type: "string", required: true },
          { name: "offset", type: "number" },
        ],
        returns: "products[] (same shape as search_products), nextOffset, similarProducts?",
        note: "Frequently / recently ordered items — one-tap reorder path.",
      },
      {
        name: "get_cart",
        params: [],
        returns:
          "selectedAddress, cartTotalAmount, items[{ spinId, skuId, productId, itemName, itemVariant, quantity, isInStockAndAvailable, mrp, discountedFinalPrice, maxQuantity }], billBreakdown{ lineItems[], toPay }, cartId, unserviceableItems?, paymentOptions",
        note: "Auth handled by the server. The backend re-reads this before every checkout — the model never sets the amount.",
      },
      {
        name: "update_cart",
        params: [
          { name: "selectedAddressId", type: "string", required: true },
          { name: "items", type: "object[]", required: true, desc: "[{ spinId, skuId, quantity }]" },
        ],
        returns: "same shape as get_cart, plus removedOutOfStockItems?, reducedQuantityItems?",
        note: "REPLACES the entire cart with the provided items, rather than merging.",
      },
      {
        name: "clear_cart",
        params: [],
        returns: "{ verified: true } or { verified: null, acknowledged: true }",
        note: "Run before switching delivery address mid-cart.",
      },
      {
        name: "apply_coupon",
        params: [{ name: "couponCode", type: "string", required: true, desc: "case-insensitive" }],
        returns: "InstamartCart (same shape as get_cart with the coupon discount reflected)",
        note: "Not fully rolled out — call list_coupons first.",
      },
      {
        name: "list_coupons",
        params: [{ name: "addressId", type: "string", required: true }],
        returns: "availableCoupons[{ couponCode, title, description?, isApplicable, applicabilityStatus, tnc?, offerId? }]",
        note: "Order: get_addresses → update_cart (non-empty) → list_coupons → user picks → apply_coupon.",
      },
      {
        name: "get_payment_options",
        params: [{ name: "addressId", type: "string", desc: "recommended" }],
        returns: "platforms{ mobile, desktop }, cod, allMethods[], paymentAmount, placeOrderToolName",
        note: "Never ask for a UPI ID/VPA (NPCI compliance) — show only the returned methods.",
      },
      {
        name: "check_payment_status",
        params: [
          { name: "paasId", type: "string", required: true },
          { name: "orderId", type: "string" },
          { name: "addressId", type: "string" },
          { name: "cartId", type: "string" },
          { name: "lat", type: "number" },
          { name: "lng", type: "number" },
        ],
        returns: "paasId, status, terminal, isTerminalSuccess, isTerminalFailure, confirmed?, orderStatus?, cartTotal?, orderId?",
        note: "Long-poll — respect the returned interval. The backend drives this loop after payment.",
      },
      {
        name: "confirm_order",
        params: [
          { name: "orderId", type: "string", required: true },
          { name: "paasId", type: "string", required: true, desc: "IM / Dineout" },
          { name: "transactionId", type: "string" },
          { name: "addressId", type: "string" },
          { name: "cartId", type: "string" },
        ],
        returns: "orderId, paasId?, orderStatus?, result: success | failed | pending",
        note: "Protected tool — intercepted by the backend, which polls payment status and confirms with the persisted order/paas ids. Idempotent.",
      },
      {
        name: "checkout",
        params: [
          { name: "addressId", type: "string", required: true },
          { name: "paymentMethod", type: "string", desc: '"UPI" | "Cash"/"COD"' },
          { name: "intentApp", type: "string", desc: "UPI app id, only with paymentMethod UPI" },
          { name: "generateUPIQR", type: "boolean", desc: "desktop UPI scan-QR" },
        ],
        returns:
          "single store → orderId, status, paymentMethod. multi-store → orders[]. UPI → orderId, transactionId, paasId, bridgeUrl, isQrFlow, pollingIntervalInMs, status PENDING_PAYMENT",
        note: "Protected tool — runs only after an explicit user authorization (Confirm & Pay) matches the live cart snapshot. NOT idempotent.",
      },
      {
        name: "get_orders",
        params: [
          { name: "count", type: "number", desc: "default 10, max 20" },
          { name: "orderType", type: "string", desc: '"DASH" | "INSTAMART", default DASH' },
          { name: "activeOnly", type: "boolean" },
        ],
        returns: "orders[{ orderId, status, createdAt, totalAmount, itemCount, deliveryAddress, paymentMethod, isActive, storeName, items[] }], hasMore",
        note: "Covers the last 15 days.",
      },
      {
        name: "get_order_details",
        params: [{ name: "orderId", type: "string", required: true }],
        returns: "orderId, status, totalBill, hasRefunds, items[{ name, quantity, finalPrice, removed }], bill{ lineItems[], grandTotal }",
        note: "Not fully rolled out.",
      },
      {
        name: "track_order",
        params: [
          { name: "orderId", type: "string", required: true },
          { name: "lat", type: "number", required: true, desc: "delivery address latitude" },
          { name: "lng", type: "number", required: true, desc: "delivery address longitude" },
        ],
        returns:
          "orderId, orderTitle, orderSubtitle, status{ statusMessage, subStatusMessage?, etaMinutes?, etaText? }, deliveryInfo?, mapInfo?, pollingIntervalSeconds",
        note: "Primary Instamart tracking tool. Poll no faster than the returned interval.",
      },
      {
        name: "get_delivery_status",
        params: [
          { name: "orderId", type: "string", required: true },
          { name: "addressId", type: "string", required: true },
        ],
        returns: "orderId, deliveryBy (epoch ms), serverNow (epoch ms), etaText?, cancelled?, delivered?, statusText?, pollIntervalSec",
        note: "Structured ETA refreshes — don't tight-loop.",
      },
      {
        name: "report_error",
        params: [
          { name: "tool", type: "string", required: true },
          { name: "errorMessage", type: "string", required: true },
          { name: "flowDescription", type: "string" },
          { name: "domain", type: "string", desc: "auto-detected" },
          { name: "toolContext", type: "object" },
          { name: "userNotes", type: "string" },
        ],
        returns: "mailto link, summary{ subject, body }",
        note: "Always include toolContext with the identifiers from the failed call.",
      },
    ],
  },
];

const ParamList = ({ params }: { params: Param[] }) => {
  if (params.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {params.map((p) => (
        <div key={p.name} className="text-xs leading-relaxed">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
            {p.name}
          </code>{" "}
          <span className="text-muted-foreground">{p.type}</span>{" "}
          <span className={p.required ? "text-destructive" : "text-muted-foreground/70"}>
            {p.required ? "required" : "optional"}
          </span>
          {p.desc ? <span className="text-muted-foreground/90"> — {p.desc}</span> : null}
        </div>
      ))}
    </div>
  );
};

const Help = () => {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tool reference</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every Swiggy Instamart tool Gemini (Piko) can call. Tools come from the Instamart MCP
          server and are prefixed at runtime as{" "}
          <code className="rounded bg-muted px-1 font-mono text-[11px]">
            swiggy-instamart__&lt;tool&gt;
          </code>
          . Checkout and confirm_order are protected and gated by the backend policy layer.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3 text-xs">
        <div className="rounded-lg border bg-muted/40 px-3 py-2">
          <span className="font-semibold text-foreground">19</span>{" "}
          <span className="text-muted-foreground">Instamart tools</span>
        </div>
        <div className="rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-muted-foreground">1 server · 1 shared token · per-server carts</span>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Availability &amp; envelope:</span>{" "}
          Swiggy tools load only while the Swiggy integration is connected with a valid token.
          Every MCP tool call returns a universal envelope —{" "}
          <code className="rounded bg-muted px-1 font-mono text-[11px]">
            {"{ success, data, error? }"}
          </code>{" "}
          — and cart state lives server-side per session, keyed to the authenticated user.
          Order-placement tools are not idempotent: after a failure, reconcile with get_orders
          before any retry.
        </CardContent>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.key} className="mb-6">
          <CardHeader>
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle>{group.title}</CardTitle>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {group.tools.length} tools
              </span>
            </div>
            <CardDescription>{group.blurb}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <th className="w-56 min-w-56 px-4 py-2.5 font-medium">Tool</th>
                  <th className="min-w-72 px-4 py-2.5 font-medium">Parameters</th>
                  <th className="min-w-56 px-4 py-2.5 font-medium">Returns</th>
                  <th className="min-w-72 px-4 py-2.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {group.tools.map((tool, i) => (
                  <tr key={tool.name} className={i > 0 ? "border-t" : ""}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-[13px] font-medium leading-tight text-foreground">
                        {tool.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] leading-tight text-muted-foreground/70">
                        swiggy-instamart__{tool.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ParamList params={tool.params} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {tool.returns}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block text-xs leading-relaxed text-muted-foreground">
                        {tool.note}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="p-4 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Ordering safety:</span> Checkout is a{" "}
          <span className="text-foreground">protected tool</span> — the backend treats Gemini
          as the reasoning layer, not the security boundary. Before any checkout it re-reads the
          live Swiggy cart, validates it against the spending limit (default ₹500), requires an
          explicit user authorization recorded server-side (order snapshot, amount, address and
          payment method, expiring in 5 minutes), and executes the Swiggy{" "}
          <code className="rounded bg-muted px-1 font-mono text-[11px]">checkout</code> only when
          the current cart matches that authorization. UPI payments surface as a Swiggy QR flow,
          and the backend drives check_payment_status → confirm_order only after a terminal
          success. COD completes the order directly.
        </CardContent>
      </Card>
    </div>
  );
};

export default Help;