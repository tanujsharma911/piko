import { Config } from "db";
import { config } from "../config/env.js";

let cachedClientId: string | null = null;

/**
 * Register client with Swiggy's DCR (Dynamic Client Registration)
 * @returns
 */
export async function getSwiggyClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  const doc = await Config.findOne({ key: "swiggy_client_id" });

  if (doc) {
    cachedClientId = doc.value;
    return cachedClientId;
  }

  const res = await fetch(`${config.SWIGGY_AUTH_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "agentic_commerce",
      redirect_uris: [config.SWIGGY_REDIRECT_URI],
      grant_types: ["authorization_code"],
    }),
  });

  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const data = (await res.json()) as { client_id: string };

  await Config.create({
    key: "swiggy_client_id",
    value: data.client_id,
  });

  cachedClientId = data.client_id;
  return cachedClientId;
}
