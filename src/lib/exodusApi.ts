import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

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
    const res = await fetchWithTimeout(env.EXODUS_AUTH_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.EXODUS_AUTH_CLIENT_ID!,
        client_secret: env.EXODUS_AUTH_CLIENT_SECRET!,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    }, 4000);
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

interface CountByNipResponse {
  data?: { actual_visit_by_period?: Record<string, number> };
  error?: { status: boolean; msg: string; code: number };
}

/**
 * Actual visit count (by month) for ONE nip, across [periodeAwal, periodeAkhir]
 * (both "YYYYMM", inclusive) — feeds KPI Monitoring's Call Activity pillar
 * (src/lib/sync/kpiCallActivitySync.ts), the "Get Count Visit By NIP"
 * endpoint referenced but not yet implemented as of docs/TODO.md #38
 * (2026-09-08: stakeholder supplied the exact URL). Unlike
 * getVisitCountByCustomerOutlet, this is already scoped to one nip, so the
 * response has no per-nip array wrapper.
 */
export async function getVisitCountByNip(
  nip: string,
  periodeAwal: string,
  periodeAkhir: string
): Promise<Record<string, number> | null> {
  if (!isConfigured || !nip) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/activity/v1/visits/count-by-nip`);
    url.searchParams.set("nip", nip);
    url.searchParams.set("periode_awal", periodeAwal);
    url.searchParams.set("periode_akhir", periodeAkhir);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CountByNipResponse;
    if (body.error?.status) return null;

    return body.data?.actual_visit_by_period ?? {};
  } catch {
    return null;
  }
}

export interface ExodusCustomer {
  customerCode: string | null;
  name: string;
  position: string | null;
  specialist: string | null;
  customerCodeExodus: string | null; // == API's CustomerCodeExodus (e.g. "C14")
  // `IsVerified` (2026-09-10) — confirmed present on core/v1/outlets/{id}/
  // customers's raw response (unlike promotion/v1/pssp/settlements/
  // customers-databases's user_nip-scoped shape, which never carries it).
  // Defaults false when the endpoint doesn't send the field at all, so an
  // absent field never wins a verified-vs-unverified dedup by accident.
  isVerified: boolean;
}

// API casing is inconsistent between endpoints in practice (PascalCase on
// /customers/users/{nip} and /outlets/{id}/customers, snake_case on
// /customers per the sample docs reference) — read both defensively rather
// than assuming one. Shared by getExodusCustomersForMr and
// getExodusCustomersByOutletCode below — same customer object shape either way.
function parseExodusCustomerList(data: unknown[]): ExodusCustomer[] {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return (data as Record<string, unknown>[])
    .map((c) => ({
      customerCode: str(c.CustomerCode) ?? str(c.customer_code),
      name: str(c.Name) ?? str(c.name) ?? "",
      position: str(c.Position) ?? str(c.position),
      specialist: str(c.Specialist) ?? str(c.specialist),
      customerCodeExodus: str(c.CustomerCodeExodus) ?? str(c.customer_code_exodus),
      isVerified: (c.IsVerified ?? c.is_verified) === true,
    }))
    .filter((c) => c.name);
}

// Per-nip cache, same idea as cachedPricing below — /customers/users/{nip}
// returns one MR's whole customer roster in one call, reused across
// multiple outlets that MR covers rather than re-fetching per outlet.
// Kept as a fallback (used by scripts/syncCustomerCodeExodus.ts) even though
// customer.ts's outlet picker moved to the per-outlet endpoint below
// (2026-09-02 — /customers/users/{nip} has no outlet field at all).
const customersCacheByNip = new Map<string, { list: ExodusCustomer[]; expiresAt: number }>();
const CUSTOMERS_TTL_MS = 5 * 60 * 1000;

/**
 * A given MR's full customer (doctor) roster from the Exodus core customers
 * API. Scoped by MR nip, NOT by outlet — this endpoint carries no outlet
 * field at all, confirmed against the real API. Superseded as customer.ts's
 * outlet-picker source by getExodusCustomersByOutletCode below (2026-09-02) —
 * kept only for scripts/syncCustomerCodeExodus.ts's per-active-MR batch scan.
 */
export async function getExodusCustomersForMr(nip: string): Promise<ExodusCustomer[] | null> {
  if (!isConfigured || !nip) return null;
  const cached = customersCacheByNip.get(nip);
  if (cached && cached.expiresAt > Date.now()) return cached.list;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${env.EXODUS_API_BASE_URL}/core/v1/customers/users/${encodeURIComponent(nip)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown>[]; error?: { status: boolean } };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    const list = parseExodusCustomerList(body.data);
    customersCacheByNip.set(nip, { list, expiresAt: Date.now() + CUSTOMERS_TTL_MS });
    return list;
  } catch {
    return null;
  }
}

export interface ExodusCustomerDbEntry {
  customerCode: string | null;
  customerCodeExodus: string | null;
  name: string;
  outletCode: string | null;
  specialist: string | null;
  position: string | null;
  status: string | null; // e.g. "inactive-new", "active-new", "active-repeat"
}

const customersDbCacheByNip = new Map<string, { list: ExodusCustomerDbEntry[]; expiresAt: number }>();

/**
 * One MR's FULL customer roster (all statuses, active AND inactive) from
 * Exodus's PSSP settlements database — unlike getExodusCustomersByOutletCode
 * (customer.ts's primary outlet-picker source), which only returns customers
 * Exodus currently considers "confirmed at this outlet" and appears to drop
 * inactive ones. Each row DOES carry outlet_code (unlike the old
 * core/v1/customers/users/{nip} that getExodusCustomersForMr uses), so
 * callers can still filter down to one outlet. Used as an enrichment pass in
 * customer.ts's getCustomersByOutlet — adds customers missing from the
 * primary source, not a replacement for it (2026-09-07, user report:
 * inactive customers not showing up in the dropdown).
 */
export async function getExodusCustomerDatabaseByNip(nip: string): Promise<ExodusCustomerDbEntry[] | null> {
  if (!isConfigured || !nip) return null;
  const cached = customersDbCacheByNip.get(nip);
  if (cached && cached.expiresAt > Date.now()) return cached.list;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/promotion/v1/pssp/settlements/customers-databases`);
    url.searchParams.set("user_nip", nip);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { customers?: Record<string, unknown>[] }; error?: { status: boolean } };
    if (body.error?.status || !Array.isArray(body.data?.customers)) return null;

    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    const list: ExodusCustomerDbEntry[] = body.data.customers
      .map((c) => ({
        customerCode: str(c.customer_code),
        customerCodeExodus: str(c.customer_code_exodus),
        name: str(c.customer_name) ?? "",
        outletCode: str(c.outlet_code),
        specialist: str(c.customer_specialist),
        position: str(c.position),
        status: str(c.status),
      }))
      .filter((c) => c.name);

    customersDbCacheByNip.set(nip, { list, expiresAt: Date.now() + CUSTOMERS_TTL_MS });
    return list;
  } catch {
    return null;
  }
}

// outlet_code → Exodus's own numeric outlet id essentially never changes
// once assigned, so this is cached far longer than the other exodusApi.ts
// caches (30 min) — it's a pure lookup, not something that goes stale like
// pricing/customer rosters do.
const outletIdCacheByCode = new Map<string, { id: number | null; expiresAt: number }>();
const OUTLET_ID_TTL_MS = 30 * 60 * 1000;

/**
 * Translates our outlet_code (== Outlet.kodePI) to Exodus's own numeric
 * outlet id (`core/v1/outlets?outlet_code=...`) — needed because
 * core/v1/outlets/{id}/customers below is keyed by that numeric id, not the
 * code. Returns null (not throw) on any failure/no-match, same "degrade to
 * no data" contract as the rest of this file.
 */
export async function getExodusOutletIdByCode(outletCode: string): Promise<number | null> {
  if (!isConfigured || !outletCode) return null;
  const cached = outletIdCacheByCode.get(outletCode);
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/core/v1/outlets`);
    url.searchParams.set("outlet_code", outletCode);
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }, 4000);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id: number; outlet_code: string }[]; error?: { status: boolean } };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    const match = body.data.find((o) => o.outlet_code === outletCode) ?? body.data[0];
    const id = match?.id ?? null;
    outletIdCacheByCode.set(outletCode, { id, expiresAt: Date.now() + OUTLET_ID_TTL_MS });
    return id;
  } catch {
    return null;
  }
}

function parseBudgetResponse(json: unknown): number {
  if (!json) return 0;
  if (typeof json === "number") return json;

  const data =
    typeof json === "object" && json !== null && "data" in json
      ? (json as { data: unknown }).data
      : json;

  if (typeof data === "number") return data;

  const extractCost = (obj: Record<string, unknown>): number => {
    // Check inside nested 'cost' object if present
    const costObj =
      typeof obj.cost === "object" && obj.cost !== null
        ? (obj.cost as Record<string, unknown>)
        : obj;

    return (
      Number(
        costObj.total_discount_base_cost ??
          costObj.discount_base_cost ??
          costObj.total_discount_real_cost ??
          costObj.discount_real_cost ??
          costObj.total_entertain_base_cost ??
          costObj.entertain_base_cost ??
          costObj.total_entertain ??
          costObj.budget_entertain ??
          costObj.history_entertain ??
          costObj.entertain ??
          costObj.budget ??
          costObj.total_budget ??
          costObj.total ??
          costObj.value ??
          costObj.amount ??
          0
      ) || 0
    );
  };

  if (Array.isArray(data)) {
    if (data.length === 0) return 0;

    // Map each month item to { period: string, cost: number }
    const monthlyItems = data
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const p = String((item as any).period || "");
          const c = extractCost(item as Record<string, unknown>);
          return { period: p, cost: c };
        }
        return { period: "", cost: typeof item === "number" ? item : 0 };
      })
      .filter((it) => it.period);

    // Sort by period ascending (e.g. 2026-01, 2026-02, ...)
    monthlyItems.sort((a, b) => a.period.localeCompare(b.period));

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, "0");
    const curPeriod = `${curYear}-${curMonth}`;

    // Months up to or before current month
    const pastMonths = monthlyItems.filter((it) => it.period <= curPeriod);

    // Strategy 1: check the 3 months immediately preceding current month (B-3)
    const last3Preceding = pastMonths.slice(-4, -1);
    const precedingSum = last3Preceding.reduce((s, it) => s + it.cost, 0);

    if (precedingSum > 0) {
      return Math.round(precedingSum / 3);
    }

    // Strategy 2: "ambil 3 bulan yang paling dekat dengan sekarang, atau yang ada trus dibagi 3"
    // Filter months with cost > 0, reversed so latest active months come first
    const activeMonths = pastMonths.filter((it) => it.cost > 0).reverse();

    if (activeMonths.length > 0) {
      const top3Active = activeMonths.slice(0, 3);
      const sumActive = top3Active.reduce((s, it) => s + it.cost, 0);
      return Math.round(sumActive / 3);
    }

    // Fallback across all available data items
    const anyActive = monthlyItems.filter((it) => it.cost > 0).reverse().slice(0, 3);
    if (anyActive.length > 0) {
      const sumAny = anyActive.reduce((s, it) => s + it.cost, 0);
      return Math.round(sumAny / 3);
    }

    return 0;
  }

  if (typeof data === "object" && data !== null) {
    return extractCost(data as Record<string, unknown>);
  }

  return 0;
}

/**
 * Fetches budget / history entertain for an outlet from Exodus:
 * `/analytics/v1/budgets`
 * Required query parameters:
 * - structure_period: last date of current month in RFC3339 format (e.g. "2026-09-30T17:00:00.000Z")
 * - period: year only (e.g. "2026")
 * - outlet_ids: numeric Exodus outlet ID from getExodusOutletIdByCode
 */
export async function getExodusOutletBudgets(
  outletCode: string,
  params?: { structurePeriod?: string; period?: string | number }
): Promise<number | null> {
  if (!outletCode) return null;

  const outletId = await getExodusOutletIdByCode(outletCode);
  if (outletId == null) {
    console.warn(`[Exodus] Outlet ID not found for code ${outletCode}`);
    return null;
  }

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStr = String(month + 1).padStart(2, "0");
    const lastDay = new Date(year, month + 1, 0).getDate();

    // Period: Tahun saja (misal "2026")
    let period = params?.period ? String(params.period) : String(year);
    const mYear = period.match(/^(\d{4})/);
    if (mYear) {
      period = mYear[1];
    }

    let structurePeriod = params?.structurePeriod;
    if (!structurePeriod) {
      structurePeriod = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}T17:00:00.000Z`;
    } else if (/^\d{2}-\d{2}-\d{4}$/.test(structurePeriod)) {
      const [d, m, y] = structurePeriod.split("-");
      structurePeriod = `${y}-${m}-${d}T17:00:00.000Z`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(structurePeriod)) {
      structurePeriod = `${structurePeriod}T17:00:00.000Z`;
    }

    const url = new URL(`${env.EXODUS_API_BASE_URL}/analytics/v1/budgets`);
    url.searchParams.set("structure_period", structurePeriod);
    url.searchParams.set("period", period);
    url.searchParams.set("outlet_ids", String(outletId));

    const res = await fetchWithTimeout(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }, 4000);

    if (!res.ok) {
      console.error(`[Exodus] /analytics/v1/budgets error status: ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (!text || text.trim() === "") {
      return 0;
    }

    const json = JSON.parse(text);
    return parseBudgetResponse(json);
  } catch (err) {
    console.error(`[Exodus] Error in getExodusOutletBudgets for ${outletCode}:`, err);
    return null;
  }
}

// Full outlet_code → Exodus's own numeric outlet id, fetched UNFILTERED in
// one call (like getLiveProductPricing) instead of per-code (like
// getExodusOutletIdByCode above) — needed for /api/poa-doctors' outlet_id
// field, which can touch every outlet company-wide; looping the per-code
// call there would violate docs/PERFORMANCE.md's call-in-loop rule.
let cachedOutletIds: { map: Map<string, number>; expiresAt: number } | null = null;
const OUTLET_IDS_TTL_MS = 30 * 60 * 1000;

export async function getLiveOutletIds(): Promise<Map<string, number> | null> {
  if (!isConfigured) return null;
  if (cachedOutletIds && cachedOutletIds.expiresAt > Date.now()) return cachedOutletIds.map;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${env.EXODUS_API_BASE_URL}/core/v1/outlets`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id: number; outlet_code: string }[]; error?: { status: boolean } };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    const map = new Map<string, number>();
    for (const o of body.data) {
      if (o.outlet_code) map.set(o.outlet_code, o.id);
    }
    cachedOutletIds = { map, expiresAt: Date.now() + OUTLET_IDS_TTL_MS };
    return map;
  } catch {
    return null;
  }
}

// Per-outlet-code cache, same TTL/idea as customersCacheByNip above.
const customersCacheByOutletCode = new Map<string, { list: ExodusCustomer[]; expiresAt: number }>();

/**
 * Customers actually confirmed AT this outlet, straight from Exodus
 * (`core/v1/outlets/{id}/customers`) — replaces the old MR-roster-via-nip
 * approach (getExodusCustomersForMr) as customer.ts's outlet picker source
 * (2026-09-02, user request): that endpoint has no outlet field at all, so
 * it could only ever return an MR's WHOLE roster unfiltered by outlet. This
 * one is genuinely outlet-scoped at the source, no local DB gating needed.
 */
export async function getExodusCustomersByOutletCode(outletCode: string): Promise<ExodusCustomer[] | null> {
  if (!isConfigured || !outletCode) return null;
  const cached = customersCacheByOutletCode.get(outletCode);
  if (cached && cached.expiresAt > Date.now()) return cached.list;

  const outletId = await getExodusOutletIdByCode(outletCode);
  if (outletId == null) return null;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${env.EXODUS_API_BASE_URL}/core/v1/outlets/${outletId}/customers`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { customer?: Record<string, unknown>[] }; error?: { status: boolean } };
    if (body.error?.status) return null;

    const list = parseExodusCustomerList(body.data?.customer ?? []);
    customersCacheByOutletCode.set(outletCode, { list, expiresAt: Date.now() + CUSTOMERS_TTL_MS });
    return list;
  } catch {
    return null;
  }
}

export interface LivePricing {
  hna: number;             // == API's sell_price
  nilaiRPersen: number | null; // r_value / sell_price, same formula scripts/importProductR.ts used against the old Excel source
  rValue: number | null;   // == API's r_value (Rupiah), raw — not persisted on Product, only nilaiRPersen (the ratio) is
  exodusProductId: number | null; // == API's `id` (distinct from product_code/kodeProduk)
  principalId: number | null;     // == API's product_principal.id
  principalName: string | null;   // == API's product_principal.name
  principalCode: string | null;   // == API's product_principal.code
  categoryProduct: string | null; // == API's product_category.name
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
 * jadiin nilai r jadi persentase based on sell_price nya"). Also carries
 * `id`/product_principal/product_category (2026-09-02, /api/poa-doctors
 * principal fields request) — poaDoctorsRows.ts writes those through to
 * Product's principal/category columns opportunistically. Every other
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
    const res = await fetchWithTimeout(`${env.EXODUS_API_BASE_URL}/core/v1/products`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }, 5000);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        id: number | null;
        product_code: string;
        sell_price: number | null;
        r_value: number | null;
        product_principal: { id: number; name: string; code: string } | null;
        product_category: { id: number; name: string; code: string } | null;
      }[];
      error?: { status: boolean };
    };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    const map = new Map<string, LivePricing>();
    for (const p of body.data) {
      if (!p.product_code || !p.sell_price || p.sell_price <= 0) continue;
      map.set(p.product_code.trim(), {
        hna: p.sell_price,
        nilaiRPersen: p.r_value != null ? p.r_value / p.sell_price : null,
        rValue: p.r_value,
        exodusProductId: p.id ?? null,
        principalId: p.product_principal?.id ?? null,
        principalName: p.product_principal?.name ?? null,
        principalCode: p.product_principal?.code ?? null,
        categoryProduct: p.product_category?.name ?? null,
      });
    }
    cachedPricing = { map, expiresAt: Date.now() + PRICING_TTL_MS };
    return map;
  } catch {
    return null;
  }
}

// Per-outlet cache, same idea as cachedPricing/customersCacheByNip above.
const discountRequestsCacheByOutlet = new Map<string, { list: ExodusDiscountRequest[]; expiresAt: number }>();
const DISCOUNT_TTL_MS = 5 * 60 * 1000;

interface DiscountProductOutletResponse {
  data?: {
    discount_type?: string;
    request_doc_date: string | null;
    start_date?: string | null;
    end_date?: string | null;
    products?: { product_code: string; principal_percentage: number | null; distributor_percentage?: number | null }[];
  }[];
  error?: { status: boolean };
}

interface ExodusDiscountRequest {
  discountType: string;
  requestDocDate: string | null;
  startDate: string | null;
  endDate: string | null;
  products: { productCode: string; principalPct: number; distributorPct: number }[];
}

/**
 * Raw discount requests for one outlet, from the Exodus discount-request API
 * ("Doc API Eksternal Promotion", request/discount/product-outlet) — shared
 * fetch backing getDiscountsForOutlet, getExodusDplContracts and
 * getExodusDiskonHistory below, so those three views cost one HTTP round
 * trip (+ pagination) per outlet, not three. Endpoint requires page/limit,
 * so this pages through to exhaustion. Only outlet-scoped (single outlet_code
 * per call) — deliberately NOT used for company-wide/multi-outlet batch
 * lookups (see getDiskonByOutlets in customer.ts, which stays DB-only) since
 * that would mean one HTTP call per outlet in a loop (docs/PERFORMANCE.md §2
 * point 4, N+1-via-external-call).
 */
async function getDiscountRequestsForOutlet(outletCode: string): Promise<ExodusDiscountRequest[] | null> {
  if (!isConfigured || !outletCode) return null;
  const cached = discountRequestsCacheByOutlet.get(outletCode);
  if (cached && cached.expiresAt > Date.now()) return cached.list;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const list: ExodusDiscountRequest[] = [];
    const limit = 100;
    // ponytail: hard page cap as a runaway-loop guard, not a real limit —
    // raise if an outlet ever legitimately has 5000+ discount requests.
    for (let page = 1; page <= 50; page++) {
      const url = new URL(`${env.EXODUS_API_BASE_URL}/promotion/v1/request/discount/product-outlet`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("outlet_code", outletCode);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!res.ok) break;
      const body = (await res.json()) as DiscountProductOutletResponse;
      if (body.error?.status || !Array.isArray(body.data)) break;

      for (const req of body.data) {
        list.push({
          discountType: req.discount_type ?? "",
          requestDocDate: req.request_doc_date ?? null,
          startDate: req.start_date ?? null,
          endDate: req.end_date ?? null,
          products: (req.products ?? [])
            .filter((p) => p.product_code && p.principal_percentage != null)
            .map((p) => ({ productCode: p.product_code, principalPct: p.principal_percentage!, distributorPct: p.distributor_percentage ?? 0 })),
        });
      }

      if (body.data.length < limit) break;
    }

    discountRequestsCacheByOutlet.set(outletCode, { list, expiresAt: Date.now() + DISCOUNT_TTL_MS });
    return list;
  } catch {
    return null;
  }
}

export interface ExodusDiscountPct {
  principalPct: number;
  distributorPct: number;
}

/**
 * Principal + distributor discount percentage per product code, for one
 * outlet — replaces the previously hardcoded/manual finalDiscountPct AND
 * diskonDistributorPct on POA Standarisasi's Finalisasi phase (2026-08-28
 * decision for principal; 2026-09-07 extended to also pull distributor_percentage
 * instead of leaving it manual, see poaStandarisasi.ts's getPoaStandarisasiDetail).
 * Duplicate product_code across multiple discount requests for the same
 * outlet: latest request_doc_date wins (DPL rows have no request_doc_date —
 * treated as oldest, so any dated DPF request wins the tie against them).
 */
export async function getDiscountsForOutlet(outletCode: string): Promise<Map<string, ExodusDiscountPct> | null> {
  const reqs = await getDiscountRequestsForOutlet(outletCode);
  if (!reqs) return null;

  const map = new Map<string, ExodusDiscountPct>();
  const dateByCode = new Map<string, string>();
  for (const req of reqs) {
    const docDate = req.requestDocDate ?? "";
    for (const p of req.products) {
      const prevDate = dateByCode.get(p.productCode);
      if (prevDate !== undefined && prevDate >= docDate) continue;
      dateByCode.set(p.productCode, docDate);
      map.set(p.productCode, { principalPct: p.principalPct, distributorPct: p.distributorPct });
    }
  }
  return map;
}

/** Local YYYYMM for an Exodus ISO date — dates come back as WIB midnight expressed in UTC (e.g. "...T17:00:00Z" == 00:00 WIB next day), so add the +7h offset before reading the month to avoid an off-by-one near month boundaries. */
function isoToYYYYMM(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface ExodusDplContract {
  kodeProduk: string;
  newOnPi: number;
  prdAwal: string;
  prdAkhir: string;
}

/**
 * DPL (period-scoped) discount contracts for one outlet, live from Exodus —
 * replaces DiskonKontrak (previously imported from "internal/DPL <bulan
 * tahun>.xlsx", see scripts/importDpl.ts) as the PRIMARY source behind POA
 * Estimasi's "% Diskon (DPL/DPF)" default (2026-08-28 decision, see
 * customer.ts's getDiskonByOutlet). Same shape as customer.ts's
 * DiskonByProduct so callers' existing resolveDiskonContract period-overlap
 * logic (LineItemEditor.tsx) needs no changes. Only rows with both
 * start_date/end_date are usable as a period — DPF rows (no date range) are
 * NOT included here, see getExodusDiskonHistory for those.
 */
export async function getExodusDplContracts(outletCode: string): Promise<ExodusDplContract[] | null> {
  const reqs = await getDiscountRequestsForOutlet(outletCode);
  if (!reqs) return null;

  const out: ExodusDplContract[] = [];
  for (const req of reqs) {
    if (req.discountType !== "DPL" || !req.startDate || !req.endDate) continue;
    const prdAwal = isoToYYYYMM(req.startDate);
    const prdAkhir = isoToYYYYMM(req.endDate);
    for (const p of req.products) out.push({ kodeProduk: p.productCode, newOnPi: p.principalPct, prdAwal, prdAkhir });
  }
  return out;
}

export interface ExodusDiskonHistoryRow {
  kodeProduk: string;
  maxDiskonPct: number;
}

/**
 * DPF (single-PO, not period-scoped) discount requests for one outlet, live
 * from Exodus — replaces DiskonHistory (previously imported from
 * "internal/*Data Diskon All Product*.xlsx", see
 * scripts/importDiskonHistory.ts) as the FALLBACK source behind POA
 * Estimasi's "% Diskon (DPL/DPF)" default, used only when no DPL contract
 * covers the outlet+product+period (2026-08-28 decision, see customer.ts's
 * getDiskonHistoryByOutlet). Same "highest single-invoice %" semantic as the
 * old DiskonHistory.maxDiskonPct — takes the max principal_percentage across
 * every DPF request on file for a product, not the most recent.
 */
export async function getExodusDiskonHistory(outletCode: string): Promise<ExodusDiskonHistoryRow[] | null> {
  const reqs = await getDiscountRequestsForOutlet(outletCode);
  if (!reqs) return null;

  const maxByCode = new Map<string, number>();
  for (const req of reqs) {
    if (req.discountType !== "DPF") continue;
    for (const p of req.products) {
      const prev = maxByCode.get(p.productCode);
      if (prev === undefined || p.principalPct > prev) maxByCode.set(p.productCode, p.principalPct);
    }
  }
  return [...maxByCode.entries()].map(([kodeProduk, maxDiskonPct]) => ({ kodeProduk, maxDiskonPct }));
}

export interface ExodusOutletMaster {
  code: string;
  name: string;
  sector: string | null;
  city: string | null;
  territoryName: string | null;
}

/**
 * One NIP's own outlets from Exodus (core/v1/outlets/users?nip=..., DIRECTLY
 * per-nip-scoped) — replaces Nexus get_outlet_by_nip as outletSync.ts's
 * outlet source (2026-09-02: "gapake nexus lagi" decision; corrected same
 * day after confirming against the real API that this endpoint DOES take a
 * `nip` param — the earlier no-param call 500'd with "GetOutletByUserNIP:
 * user projects not found", which in hindsight was exactly this: the
 * handler needs the param it's named after). No pagination needed — one
 * NIP's outlet count is small. Still carries no territory CODE, only this
 * human-readable TerritoryName (see getExodusNipZoneHierarchy below for the
 * code side, from a separate endpoint).
 */
export async function getExodusOutletsByNip(nip: string): Promise<ExodusOutletMaster[] | null> {
  if (!isConfigured || !nip) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/core/v1/outlets/users`);
    url.searchParams.set("nip", nip);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        OutletCode: string;
        Name: string;
        OutletSectorName: string | null;
        City: string | null;
        TerritoryName: string | null;
      }[];
      error?: { status: boolean };
    };
    if (body.error?.status || !Array.isArray(body.data)) return null;

    return body.data
      .filter((o) => o.OutletCode)
      .map((o) => ({
        code: o.OutletCode,
        name: o.Name?.trim() || o.OutletCode,
        sector: o.OutletSectorName?.trim() || null,
        city: o.City?.trim() || null,
        territoryName: o.TerritoryName?.trim() || null,
      }));
  } catch {
    return null;
  }
}

export interface NipZoneHierarchy {
  territory: { code: string; name: string } | null;
  subarea: { code: string; name: string } | null;
  area: { code: string; name: string } | null;
  region: { code: string; name: string } | null;
}

export interface ExodusZoneNode {
  zone_code: string | null;
  zone_name: string | null;
  zone_type: string | null;
  parent: ExodusZoneNode[] | null;
}

/**
 * Walks a users/parent response's own-zone + ancestor chain into the four
 * zone_types this app cares about, keyed by zone_type rather than chain
 * position — the sample response's top-most ancestor is zone_type
 * "district" (NSM-level), which has no matching Outlet column and is simply
 * never assigned here. Exported separately from the fetch so it's testable
 * without a live API call (see scripts/testExodusZoneHierarchy.ts).
 */
export function walkZoneHierarchy(root: ExodusZoneNode): NipZoneHierarchy {
  const result: NipZoneHierarchy = { territory: null, subarea: null, area: null, region: null };
  let node: ExodusZoneNode | null = root;
  while (node) {
    const code = node.zone_code?.trim();
    const name = node.zone_name?.trim();
    if (code && name) {
      if (node.zone_type === "territory" && !result.territory) result.territory = { code, name };
      else if (node.zone_type === "subarea" && !result.subarea) result.subarea = { code, name };
      else if (node.zone_type === "area" && !result.area) result.area = { code, name };
      else if (node.zone_type === "region" && !result.region) result.region = { code, name };
    }
    node = node.parent?.[0] ?? null;
  }
  return result;
}

/**
 * One NIP's own zone + ancestor zone chain, from Exodus core/v1/users/parent.
 * Own zone_type "territory" means this NIP (a Field Force) holds one
 * territory directly — the case outletSync.ts can join to outlets by name.
 * Own zone_type "subarea" means a Supervisor acting as MR (no Field Force
 * under them, User.role's existing MR-collapse) — they own no single
 * territory name, so callers get `territory: null` and must skip them from
 * outlet matching rather than guessing.
 */
export async function getExodusNipZoneHierarchy(nip: string): Promise<NipZoneHierarchy | null> {
  if (!isConfigured || !nip) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/core/v1/users/parent`);
    url.searchParams.set("nip", nip);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ExodusZoneNode[]; error?: { status: boolean } };
    if (body.error?.status || !Array.isArray(body.data) || body.data.length === 0) return null;
    return walkZoneHierarchy(body.data[0]);
  } catch {
    return null;
  }
}

/**
 * GET /promotion/v1/pssp/approval-level — the approval CEILING (not just an
 * FYI) a given PSSP submission must reach before it's "fully approved":
 * `role` can be "asm"/"sm"/"nsm", or (per Exodus's Budi Pharos, 2026-09-09
 * chat — see docs/exodus-poa-usage/01-business-rules.md §11) possibly
 * "asd"/"sd" — roles that don't exist in POA's own Role enum today. NOT
 * wired into any live flow yet — this is investigation-only (scripts/
 * testExodusApprovalLevel.ts) to see whether asd/sd ever actually come back
 * for real PSSP data before building the (large) role/chain work §11 needs.
 * Query param mapping to PoaLineItem fields is UNCONFIRMED with Exodus —
 * best-guess candidates from §11's table, not a settled contract.
 */
export async function getExodusApprovalLevel(params: {
  startPeriod: string; // "YYYY-MM-DD" — confirmed by testing (2026-09-09): "YYYYMM" 500s ("invalid start_period, expected YYYY-MM-DD")
  endPeriod: string;   // "YYYY-MM-DD"
  rPercentage: number; // 0-1 fraction (10% = 0.1, confirmed 2026-09-09) — matches PoaLineItem.persenPsspDokter's own DB storage format as-is, no conversion needed
  givenValue: number;  // PoaLineItem.rencanaTotalBiaya guess
  psspType: string;    // PoaLineItem.jenisPssp guess
  customerCode: string; // PoaLineItem.kodeCust guess
  outletCode: string;   // PoaLineItem.kodePI guess
  nip?: string;
}): Promise<{ role: string } | null> {
  if (!isConfigured) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/promotion/v1/pssp/approval-level`);
    url.searchParams.set("start_period", params.startPeriod);
    url.searchParams.set("end_period", params.endPeriod);
    url.searchParams.set("r_percentage", String(params.rPercentage));
    url.searchParams.set("given_value", String(params.givenValue));
    url.searchParams.set("pssp_type", params.psspType);
    url.searchParams.set("customer_code", params.customerCode);
    url.searchParams.set("outlet_code", params.outletCode);
    if (params.nip) url.searchParams.set("nip", params.nip);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[Exodus] approval-level HTTP ${res.status} for`, url.toString());
      return null;
    }
    const body = (await res.json()) as { data?: { role?: string }; error?: { status: boolean; msg?: string } };
    if (body.error?.status || !body.data?.role) {
      console.error(`[Exodus] approval-level error:`, body.error);
      return null;
    }
    return { role: body.data.role };
  } catch (err) {
    console.error(`[Exodus] approval-level fetch failed:`, err);
    return null;
  }
}

export interface ExodusZoneSummaryNode {
  nip: string;
  name: string | null;
  role_name: string | null;
  zone_id: number;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  zone: unknown;
  parent: ExodusZoneSummaryNode[] | null;
}

interface ZoneSummaryResponse {
  data?: ExodusZoneSummaryNode[];
  error?: { status: boolean; msg?: string; code?: number };
}

/**
 * INVESTIGATION ONLY (2026-09-10) — not wired into any live flow yet. GET
 * core/v1/users/zone-summary/parent: one NIP's own zone + upward ancestor
 * chain (subarea -> area -> region -> district), same shape idea as
 * getExodusNipZoneHierarchy's users/parent but carries nip/name/role_name at
 * every level instead of just zone code/name. Untested against the real API
 * — see scripts/testExodusZoneSummary.ts.
 */
export async function getExodusZoneSummaryParent(params: {
  nip?: string;
  zoneType?: string;
  period?: string;
}): Promise<ExodusZoneSummaryNode[] | null> {
  if (!isConfigured) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/core/v1/users/zone-summary/parent`);
    if (params.nip) url.searchParams.set("nip", params.nip);
    if (params.zoneType) url.searchParams.set("zone_type", params.zoneType);
    if (params.period) url.searchParams.set("period", params.period);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[Exodus] zone-summary/parent HTTP ${res.status} for`, url.toString());
      return null;
    }
    const body = (await res.json()) as ZoneSummaryResponse;
    if (body.error?.status || !Array.isArray(body.data)) {
      console.error(`[Exodus] zone-summary/parent error:`, body.error);
      return null;
    }
    return body.data;
  } catch (err) {
    console.error(`[Exodus] zone-summary/parent fetch failed:`, err);
    return null;
  }
}

/**
 * INVESTIGATION ONLY (2026-09-10) — not wired into any live flow yet. GET
 * core/v1/users/zone-summary/child: zones matching `keyword`/`zoneType`,
 * paginated, each row's OWN nip/name (not an ancestor's) — a row with empty
 * `nip` and null `name` is the signal this might close the outlet-nexus-
 * migration OQ-1/OQ-3 gap (docs/outlet-nexus-migration/01-business-rules.md),
 * since it's indexed per-zone rather than per-nip like get_outlet_by_nip.
 * Zone-to-Outlet(kodePI) mapping is UNCONFIRMED — do not wire into
 * coveredByNip/coveredByRole without an SDD spec (docs/sdd/01-when-and-
 * workflow.md — ambiguous mapping + touches approval role/access matrix).
 */
export async function getExodusZoneSummaryChild(params: {
  keyword?: string;
  zoneType?: string;
  page?: number;
  limit?: number;
}): Promise<ExodusZoneSummaryNode[] | null> {
  if (!isConfigured) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const url = new URL(`${env.EXODUS_API_BASE_URL}/core/v1/users/zone-summary/child`);
    if (params.keyword) url.searchParams.set("keyword", params.keyword);
    if (params.zoneType) url.searchParams.set("zone_type", params.zoneType);
    if (params.page) url.searchParams.set("page", String(params.page));
    if (params.limit) url.searchParams.set("limit", String(params.limit));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[Exodus] zone-summary/child HTTP ${res.status} for`, url.toString());
      return null;
    }
    const body = (await res.json()) as ZoneSummaryResponse;
    if (body.error?.status || !Array.isArray(body.data)) {
      console.error(`[Exodus] zone-summary/child error:`, body.error);
      return null;
    }
    return body.data;
  } catch (err) {
    console.error(`[Exodus] zone-summary/child fetch failed:`, err);
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
