import { env } from "@/lib/env";

/**
 * Client for the external "Exodus Activity" API (Pharos) — visit history by
 * MR, per outlet+customer (see "Doc API Eksternal Activity", 2026-08-04).
 * Optional feature: every export here returns `null` rather than throwing
 * when EXODUS_* env vars aren't configured for this environment, or when the
 * external call itself fails — a down/unconfigured external service should
 * degrade the UI to "no data", never break the page it's called from.
 */

const isConfigured =
  !!env.EXODUS_AUTH_URL && !!env.EXODUS_AUTH_CLIENT_ID && !!env.EXODUS_AUTH_CLIENT_SECRET && !!env.EXODUS_API_BASE_URL;

// Module-level in-memory token cache — one Node process can reuse the same
// token across requests until it's close to expiring (expires_in is 3600s
// per the doc's sample response), instead of re-authenticating on every call.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!isConfigured) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  try {
    const res = await fetch(env.EXODUS_AUTH_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.EXODUS_AUTH_CLIENT_ID!,
        client_secret: env.EXODUS_AUTH_CLIENT_SECRET!,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    // 60s safety margin so a token doesn't expire mid-flight on the next call.
    const ttlMs = ((data.expires_in ?? 3600) - 60) * 1000;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(ttlMs, 0) };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export interface VisitByPeriodRow {
  nip: string;
  actualVisitByPeriod: Record<string, number>;
}

interface CountByCustomerOutletResponse {
  data?: { visits?: { nip: string; actual_visit_by_period?: Record<string, number> }[] };
  error?: { status: boolean; msg: string; code: number };
}

/**
 * Visit counts (by MR nip) for one customer at one outlet, across
 * [periodeAwal, periodeAkhir] (both "YYYYMM", inclusive).
 */
export async function getVisitCountByCustomerOutlet(
  kodeCust: string,
  kodeOutlet: string,
  periodeAwal: string,
  periodeAkhir: string
): Promise<VisitByPeriodRow[] | null> {
  if (!isConfigured || !kodeCust || !kodeOutlet) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/activity/v1/visits/count-by-customer-outlet`);
    url.searchParams.set("kode_cust", kodeCust);
    url.searchParams.set("kode_outlet", kodeOutlet);
    url.searchParams.set("periode_awal", periodeAwal);
    url.searchParams.set("periode_akhir", periodeAkhir);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CountByCustomerOutletResponse;
    if (body.error?.status) return null;

    return (body.data?.visits ?? []).map((v) => ({
      nip: v.nip,
      actualVisitByPeriod: v.actual_visit_by_period ?? {},
    }));
  } catch {
    return null;
  }
}

export interface LivePricing {
  hna: number;             // == API's sell_price
  nilaiRPersen: number | null; // r_value / sell_price, same formula scripts/importProductR.ts used against the old Excel source
}

// Short in-memory cache, same idea as cachedToken above — this is called on
// every product-list load (masterData.ts's getProducts/getScProducts), and
// the API has no per-code endpoint, only "give me everything", so fetching
// fresh on every single request would mean re-pulling all ~450 products
// every time a picker renders.
let cachedPricing: { map: Map<string, LivePricing>; expiresAt: number } | null = null;
const PRICING_TTL_MS = 5 * 60 * 1000;

/**
 * Live hna/nilaiRPersen straight from the Exodus core products API
 * (api.pharos.id/exodus/core/v1/products) — replaces the old
 * importHnaProducts.ts (hna, from Excel) + importProductR.ts (nilaiRPersen,
 * from Excel) pipeline for these two fields specifically (2026-08-26
 * decision: "hna itu basically sell_price, dan nilai R persen itu tinggal
 * jadiin nilai r jadi persentase based on sell_price nya"). Every other
 * Product field (satuan, konversiPembagi, dosis, etc.) has no equivalent
 * here and is left to the caller's own local data — this only ever
 * overrides those two fields, and returns null (never throws) on any
 * failure so callers can fall back to whatever's in the DB, same
 * "degrade to no data" contract as the rest of this file.
 */
export async function getLiveProductPricing(): Promise<Map<string, LivePricing> | null> {
  if (!isConfigured) return null;
  if (cachedPricing && cachedPricing.expiresAt > Date.now()) return cachedPricing.map;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${env.EXODUS_API_BASE_URL}/core/v1/products`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { product_code: string; sell_price: number | null; r_value: number | null }[];
      error?: { status: boolean };
    };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    const map = new Map<string, LivePricing>();
    for (const p of body.data) {
      if (!p.product_code || !p.sell_price || p.sell_price <= 0) continue;
      map.set(p.product_code.trim(), {
        hna: p.sell_price,
        nilaiRPersen: p.r_value != null ? p.r_value / p.sell_price : null,
      });
    }
    cachedPricing = { map, expiresAt: Date.now() + PRICING_TTL_MS };
    return map;
  } catch {
    return null;
  }
}

/** Every "YYYYMM" month from n-1 months ago through the current month, inclusive (n total months). */
export function lastNMonthsRange(n: number, from: Date = new Date()): { periodeAwal: string; periodeAkhir: string } {
  const periodeAkhir = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, "0")}`;
  const start = new Date(from.getFullYear(), from.getMonth() - (n - 1), 1);
  const periodeAwal = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
  return { periodeAwal, periodeAkhir };
}
