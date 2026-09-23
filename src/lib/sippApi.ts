import { env } from "@/lib/env";

/**
 * Client for the external "SIPP (Trade Marketing)" API (Pharos) — HR
 * attendance data by NIP (see "API - Trade Marketing Documentation.pdf", API
 * Doc. Ver. 1.0.2026). Feeds the Kepatuhan Absensi pillar of KPI Monitoring
 * (docs/kpi-monitoring/01-business-rules.md §2d). Same pattern as
 * src/lib/exodusApi.ts: every export returns `null` rather than throwing when
 * SIPP_* env vars aren't configured, or when the external call fails — an
 * unconfigured/down external service degrades to "no data", it never breaks
 * the caller.
 */

const isConfigured = !!env.SIPP_BASE_URL && !!env.SIPP_CLIENT_ID && !!env.SIPP_CLIENT_SECRET;

// Module-level in-memory token cache — reuse the same Bearer token across
// calls within one Node process until close to expiring (ExpiresIn is 3600s
// per the doc's sample response).
let cachedToken: { token: string; expiresAt: number } | null = null;

interface AuthVendorResponse {
  data?: { AccessToken?: string; TokenType?: string; ExpiresIn?: number };
  error?: { status: boolean; msg: string; code: number };
}

async function getAccessToken(): Promise<string | null> {
  if (!isConfigured) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  try {
    const res = await fetch(`${env.SIPP_BASE_URL}/hr/auth?auth=vendor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ClientID: env.SIPP_CLIENT_ID, ClientSecret: env.SIPP_CLIENT_SECRET }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as AuthVendorResponse;
    if (body.error?.status || !body.data?.AccessToken) return null;

    // 60s safety margin so a token doesn't expire mid-flight on the next call.
    const ttlMs = ((body.data.ExpiresIn ?? 3600) - 60) * 1000;
    cachedToken = { token: body.data.AccessToken, expiresAt: Date.now() + Math.max(ttlMs, 0) };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export interface AbsensiRecord {
  absNumber: string;
  absNip: string;
  absPTID: number;
  /** Check-in timestamp, ISO-8601 string as returned by the API. */
  absDateIn: string;
  absDateOut: string;
  /** "Y"/"N" — API's own late flag relative to the shift's reporting deadline. */
  absTelatYN: string;
}

interface AbsensiResponse {
  data?: {
    AbsNumber?: number | string;
    AbsNIP?: string;
    AbsPTID?: number;
    AbsDateIn?: string;
    AbsDateOut?: string;
    AbsTelatYN?: string;
  }[];
  error?: { status: boolean; msg: string; code: number };
}

/**
 * Attendance history for one NIP within [startDate, endDate] (both
 * "YYYY-MM-DD", inclusive). `ptId` — derived from the NIP prefix by
 * ptIdForNip() in kpiAbsensiSync.ts. A wrong ptId here doesn't
 * error, it just silently returns an empty array.
 */
export async function getAbsensiByNip(
  nip: string,
  ptId: number,
  startDate: string,
  endDate: string
): Promise<AbsensiRecord[] | null> {
  if (!isConfigured || !nip) return null;
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`${env.SIPP_BASE_URL}/hr/trademarketing?get=absensi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ AbsNIP: nip, AbsPTID: ptId, AbsStartDate: startDate, AbsEndDate: endDate }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as AbsensiResponse;
    if (body.error?.status) return null;

    return (body.data ?? []).map((r) => ({
      absNumber: String(r.AbsNumber ?? ""),
      absNip: r.AbsNIP ?? "",
      absPTID: r.AbsPTID ?? ptId,
      absDateIn: r.AbsDateIn ?? "",
      absDateOut: r.AbsDateOut ?? "",
      absTelatYN: r.AbsTelatYN ?? "N",
    }));
  } catch {
    return null;
  }
}

/**
 * Working assumption (docs/kpi-monitoring/01-business-rules.md §7-3): average
 * hours late per month relative to `deadlineHour` (08:00 WIB per the memo),
 * averaged across every attendance record in the period — an on-time day
 * contributes 0, not just the late ones, so occasional lateness and
 * chronic lateness don't collapse into the same average. Only records with a
 * parseable `absDateIn` and `absTelatYN === "Y"` contribute a positive value.
 * Returns null for an empty record set (nothing to average — "belum diisi",
 * not "0 = perfect").
 */
export function computeAvgLateHours(records: AbsensiRecord[], deadlineHour = 8): number | null {
  if (records.length === 0) return null;

  let totalLateHours = 0;
  for (const r of records) {
    if (r.absTelatYN !== "Y") continue;
    const checkIn = new Date(r.absDateIn);
    if (Number.isNaN(checkIn.getTime())) continue;
    const hourDecimal = checkIn.getHours() + checkIn.getMinutes() / 60;
    totalLateHours += Math.max(0, hourDecimal - deadlineHour);
  }
  return Math.round((totalLateHours / records.length) * 100) / 100;
}

/** [start, end] "YYYY-MM-DD" for a "YYYY-MM" period, inclusive. */
export function monthDateRange(period: string): { startDate: string; endDate: string } {
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: `${yearStr}-${monthStr}-01`,
    endDate: `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`,
  };
}
