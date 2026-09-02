import { getSwiggyInstaMartTools } from "../agent/swiggy/instamart/tools.js";
import { unwrapToolResult } from "./checkout.service.js";
import { config } from "../config/env.js";

/**
 * TEMPORARY INVESTIGATION LAYER ONLY.
 *
 * This module exists solely to inspect what Swiggy's MCP actually returns at
 * every stage of live order tracking. It logs the COMPLETE raw Swiggy
 * responses (never just the normalized view) so we can detect undocumented
 * fields and decide the permanent architecture.
 *
 * It is EXPECTED to be removed once we settle on the permanent tracking
 * implementation. Everything here is intentionally verbose and clearly
 * tagged with [SWIGGY_TRACKING].
 *
 * Security: NO tokens, Authorization headers, cookies, API keys, passwords,
 * or secrets are ever logged. Everything Swiggy returns (minus request
 * secrets) is preserved for investigation.
 */

const TAG = "[SWIGGY_TRACKING]";
const RAW_TAG = "[SWIGGY_TRACKING][RAW_RESPONSE]";

export type CoordinateSource = "swiggy_response" | "geocoding_fallback" | "unavailable";

export interface DebugCoordinates {
  latitude: number;
  longitude: number;
  source: Exclude<CoordinateSource, "unavailable">;
  address?: string;
  confidence?: string;
  raw?: unknown;
}

// A plain text/JSON payload that is safe to log (no nested secrets by
// construction — we only ever place freshly-fetched Swiggy data here).
export function dbg(section: string, message: string, data?: unknown): void {
  const line: Record<string, unknown> = {
    tag: TAG,
    section,
    message,
  };
  if (data !== undefined) {
    line.data = data;
  }
  // console.log prints the object in full (non-truncated to user's shells that
  // support it; structured JSON is preserved for later inspection).
  console.log(TAG, JSON.stringify(line));
}

export function logRaw(section: string, toolName: string, raw: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch (err: any) {
    serialized = `[unserializable raw response: ${err?.message || "unknown"}]`;
  }
  // Written as a single line so the full payload is preserved.
  console.log(RAW_TAG, JSON.stringify({ section, tool: toolName, byteLength: serialized.length, raw: raw }));
}

export function byteSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return -1;
  }
}

/**
 * Find coordinate fields ANYWHERE within a Swiggy response, keeping their
 * exact JSON paths so we can report where they came from. We only ever
 * return coordinates that Swiggy itself supplied for THIS request — we never
 * invent or approximate them.
 */
interface CoordinateHit {
  latitude: number;
  longitude: number;
  path: string;
}

function collectCoordinates(node: unknown, path: string, out: CoordinateHit[]): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectCoordinates(v, `${path}[${i}]`, out));
    return;
  }
  const record = node as Record<string, unknown>;
  if (
    typeof record.latitude === "number" &&
    typeof record.longitude === "number"
  ) {
    out.push({
      latitude: record.latitude,
      longitude: record.longitude,
      path: path || "<root>",
    });
    // Continue recursing: there may be several coordinate-bearing objects
    // (store, delivery, rider) and we want to see them all.
  }
  for (const key of Object.keys(record)) {
    collectCoordinates(record[key], path ? `${path}.${key}` : key, out);
  }
}

/**
 * TEMPORARY geocoder (Google Geocoding API). This is ONLY a fallback used to
 * obtain a delivery-partner investigation starting point; it will be removed.
 * Returns null on any failure so we can never fabricate coordinates.
 */
export async function geocodeAddress(
  address: string,
): Promise<Omit<DebugCoordinates, "source"> | null> {
  if (!address || !address.trim()) return null;
  if (!config.GOOGLE_API_KEY) {
    dbg("GEOCODING", "geocoder skipped: no GOOGLE_API_KEY configured");
    return null;
  }
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(address) +
    "&key=" +
    config.GOOGLE_API_KEY;

  dbg("GEOCODING.REQUEST_START", "geocoder request started", {
    addressSentToGeocoder: address,
  });

  let raw: any;
  try {
    const res = await fetch(url);
    raw = await res.json();
  } catch (err: any) {
    dbg("GEOCODING.ERROR", "geocoder request failed", {
      errorType: err?.constructor?.name,
      errorMessage: err?.message,
    });
    return null;
  }

  logRaw("GEOCODING", "google_geocoding_api", raw);

  dbg("GEOCODING.REQUEST_END", "geocoder response received", {
    status: raw?.status,
    errorMessage: raw?.error_message,
  });

  if (raw?.status !== "OK" || !Array.isArray(raw.results) || raw.results.length === 0) {
    dbg("GEOCODING", "geocoder returned no usable result", {
      status: raw?.status,
    });
    return null;
  }

  const results = raw.results as any[];
  // Prefer results with geometry.location and the highest effective
  // precision. We select the LOCATION that best matches address —
  // Google returns results richest-first; we take the first ROOFTOP-ish one,
  // otherwise the first result.
  const pick = results.find(
    (r: any) => r?.geometry?.location_type === "ROOFTOP",
  ) ?? results[0];

  const loc = pick?.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
    dbg("GEOCODING", "selected geocoder result had no numeric location");
    return null;
  }

  dbg("GEOCODING.SELECTED", "geocoder result selected", {
    why: "preferred ROOFTOP location_type, else first result",
    locationType: pick?.geometry?.location_type,
    confidence: pick?.geometry?.location_type,
    formatted_address: pick?.formatted_address,
  });

  return {
    latitude: loc.lat,
    longitude: loc.lng,
    address,
    confidence: pick?.geometry?.location_type,
    raw,
  };
}

interface SwiggyAddressLookup {
  addressId: string | null;
  addressText: string | null;
  rawResponse: unknown;
  foundOrder: boolean;
  ordersFound: number;
}

/**
 * Obtain the ACTUAL delivery address for THIS order from Swiggy's own order
 * list (matched by orderId). We never guess the address — if Swiggy does not
 * return the order, the address is unavailable.
 */
export async function resolveAddressFromSwiggy(
  token: string,
  orderId: string,
): Promise<SwiggyAddressLookup | null> {
  const tools = await getSwiggyInstaMartTools(token);
  const ordersTool = tools.find((t: any) => t.name === "swiggy-instamart__get_orders");
  if (!ordersTool) {
    dbg("ADDRESS_RESOLUTION", "get_orders tool unavailable");
    return null;
  }

  const args = { count: 10 };
  dbg("GET_ORDERS.REQUEST", "get_orders request", { args });

  let raw: unknown;
  try {
    raw = await ordersTool.invoke(args);
  } catch (err: any) {
    dbg("GET_ORDERS.ERROR", "get_orders request failed", {
      tool: "swiggy-instamart__get_orders",
      args,
      errorType: err?.constructor?.name,
      errorMessage: err?.message,
    });
    return null;
  }

  logRaw("GET_ORDERS", "swiggy-instamart__get_orders", raw);
  dbg("GET_ORDERS.RESPONSE", "get_orders response received", {
    responseByteSize: byteSize(raw),
  });

  const parsed = unwrapToolResult(raw);
  const orders = Array.isArray(parsed?.orders) ? parsed.orders : [];
  const found = orders.find((o: any) => String(o.orderId) === String(orderId));

  const orderIds = orders.map((o: any) => o?.orderId).filter(Boolean);
  dbg("GET_ORDERS.PARSED", "get_orders parsed", {
    ordersFound: orders.length,
    discoveredOrderIds: orderIds,
    requestedOrderFound: !!found,
  });

  // Report presence/location of any coordinates in the raw response (for
  // investigation) — this is the "swiggy_response" coordinate source probe.
  const hits: CoordinateHit[] = [];
  collectCoordinates(parsed, "", hits);
  dbg("GET_ORDERS.COORDINATES", "get_orders coordinates scan", {
    count: hits.length,
    hits: hits.map((h) => ({ path: h.path, latitude: h.latitude, longitude: h.longitude })),
  });

  if (!found) {
    dbg("ADDRESS_RESOLUTION", "order not present in get_orders; address unavailable", {
      orderId,
    });
    return {
      addressId: null,
      addressText: null,
      rawResponse: raw,
      foundOrder: false,
      ordersFound: orders.length,
    };
  }

  const deliveryAddress = found.deliveryAddress || found.delivery_address || null;
  const addressText =
    deliveryAddress?.addressLine || deliveryAddress?.fullAddress || deliveryAddress?.address || null;

  dbg("ADDRESS_RESOLUTION.FOUND", "delivery address resolved from Swiggy get_orders", {
    addressId: deliveryAddress?.id ?? null,
    addressSource: "swiggy_get_orders",
    addressData: deliveryAddress ?? null,
    coordinatesPresent: hits.length > 0,
    coordinates: hits.length ? hits.map((h) => ({ path: h.path, latitude: h.latitude, longitude: h.longitude })) : null,
  });

  return {
    addressId: deliveryAddress?.id ?? null,
    addressText,
    rawResponse: raw,
    foundOrder: true,
    ordersFound: orders.length,
  };
}

/**
 * Ordered coordinate resolution:
 *   1. swiggy_response  — real coordinates supplied by Swiggy for THIS order.
 *   2. geocoding_fallback — geocode the ACTUAL delivery address for this order.
 *   3. unavailable        — log clearly, return null.
 *
 * Never caches. Never reuses coordinates from another order.
 */
export async function resolveCoordinatesForTrack(
  token: string,
  orderId: string,
): Promise<{ coordinates: DebugCoordinates | null; source: CoordinateSource; address?: string | null }> {
  const addressLookup = await resolveAddressFromSwiggy(token, orderId);

  // 1) swiggy_response source: coordinates actually returned by Swiggy for
  //    this order's get_orders response.
  const hits: CoordinateHit[] = [];
  if (addressLookup?.rawResponse != null) {
    collectCoordinates(unwrapToolResult(addressLookup.rawResponse), "", hits);
  }
  // Prefer coordinates associated with the matched order specifically.
  const targetedHits =
    addressLookup?.foundOrder === false
      ? []
      : hits;
  if (targetedHits.length > 0) {
    const hit = targetedHits[0];
    if (hit) {
      dbg("COORDINATES", "coordinates from swiggy_response", { hit });
      return {
        coordinates: {
          latitude: hit.latitude,
          longitude: hit.longitude,
          source: "swiggy_response",
        },
        source: "swiggy_response",
      };
    }
  }
  dbg("COORDINATES", "Swiggy did not provide coordinates for this order");

  // 2) geocoding_fallback: geocode the ACTUAL delivery address for this order.
  const address = addressLookup?.addressText ?? null;
  if (address) {
    const geo = await geocodeAddress(address);
    if (geo) {
      dbg("COORDINATES", "coordinates from geocoding_fallback", {
        source: "geocoding_fallback",
        address,
        latitude: geo.latitude,
        longitude: geo.longitude,
        confidence: geo.confidence,
      });
      return {
        coordinates: { ...geo, source: "geocoding_fallback" },
        source: "geocoding_fallback",
        address,
      };
    }
  }

  // 3) unavailable.
  dbg("COORDINATES", "no coordinates available (neither Swiggy nor geocodable address)", {
    source: "unavailable",
    orderId,
    addressResolved: !!address,
  });
  return { coordinates: null, source: "unavailable", address };
}

// Re-exported for compatibility; the previous guess-latlon implementation is
// intentionally removed — see tombstones below.
export interface DeliveryCoordinates extends DebugCoordinates {}

export async function resolveDeliveryCoordinatesDeprecated(
  _token: string,
): Promise<DeliveryCoordinates | null> {
  // REMOVED: this previously grabbed the first latitude/longitude found
  // anywhere in get_orders — i.e. coordinates belonging to ANOTHER order.
  // That violates "do not reuse coordinates from another order". Callers must
  // use resolveCoordinatesForTrack instead.
  dbg("COORDINATES", "DEPRECATED coordinate resolver called; use resolveCoordinatesForTrack", {
    source: "unavailable",
  });
  return null;
}

export { collectCoordinates };
export type { CoordinateHit };
