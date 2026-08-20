/**
 * Nexus API → inferred org hierarchy (READ-ONLY — does not write to Postgres).
 *
 * Implements the algorithm from docs/org-nexus-migration/01-business-rules.md
 * §3, validated 2026-08-18 (197/198 match against the live MSSQL-derived
 * hierarchy) and confirmed by the user 2026-08-20 to ship as a PARALLEL
 * dry-run first (OQ-5) — `orgStructureSync.ts` (MSSQL) stays the actual
 * source of `User.nipAtasan` for now. This module only produces the inferred
 * hierarchy for scripts/compareOrgNexusVsMssql.ts to diff against it.
 *
 * Source endpoints (api-nexus.pharos.id, both verified live 2026-08-18/20):
 *   - GET get_employees?project=ethical → { data: { employees: [{nip, nama, zones, position}] } }
 *     No manager/atasan field at all.
 *   - GET get_subordinates?nip=X → { data: { total_data, subordinates: [{nip, nama, project, position}] } }
 *     Returns X's ENTIRE transitive subtree (every level below X), not just
 *     direct reports — see the README's "Temuan penting" correction.
 *
 * Since neither endpoint gives a direct-manager field, `nipAtasan` per person
 * is INFERRED from subtree containment: the direct manager of Y is the
 * ancestor X (some X with Y in subordinates(X)) whose OWN subtree is
 * smallest among all of Y's ancestors — i.e. the closest enclosing ancestor,
 * not the outermost one.
 */

import { nexusAuthHeaders } from "@/lib/nexusAuth";
import type { Role } from "@prisma/client";

const NEXUS_BASE = "https://api-nexus.pharos.id/api/r/poa";
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 5000;

export interface NexusEmployee {
  nip: string;
  nama: string;
  position: string;
}

/** position (Nexus) → Role (app) — docs/org-nexus-migration/01-business-rules.md §3 step 5. */
const POSITION_TO_ROLE: Record<string, Role> = {
  "Field Force": "MR",
  "Supervisor": "MR", // display-only "SPV" override lives on User.jabatan, same as the MSSQL path
  "Area Sales Manager": "ASM",
  "Sales Manager": "SM",
  "National Sales Manager": "NSM",
};

export interface InferredOrgRecord {
  nip: string;
  nama: string;
  position: string;
  role: Role | null; // null when `position` doesn't match any known mapping (unexpected/new title)
  inferredNipAtasan: string | null;
  inferredNamaAtasan: string | null;
}

async function fetchJsonWithRetry<T>(url: string, attempt = 0): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, headers: nexusAuthHeaders() });
    clearTimeout(timeout);
    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) return fetchJsonWithRetry<T>(url, attempt + 1);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    if (attempt < 1) return fetchJsonWithRetry<T>(url, attempt + 1);
    return null;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchAllEmployees(): Promise<NexusEmployee[]> {
  const resp = await fetchJsonWithRetry<{ data: { employees: NexusEmployee[] } }>(
    `${NEXUS_BASE}/get_employees?project=ethical`
  );
  return resp?.data?.employees ?? [];
}

async function fetchSubordinates(nip: string): Promise<NexusEmployee[] | null> {
  const resp = await fetchJsonWithRetry<{ data: { subordinates: NexusEmployee[] } }>(
    `${NEXUS_BASE}/get_subordinates?nip=${encodeURIComponent(nip)}`
  );
  return resp ? resp.data?.subordinates ?? [] : null;
}

export interface OrgInferenceResult {
  records: InferredOrgRecord[];
  /** NIPs (managers) whose get_subordinates call failed after retry — their whole subtree's ancestry is incomplete this run. */
  failedManagerNips: string[];
}

/**
 * Runs the full inference (§3 algorithm) against live Nexus data. Read-only —
 * makes no Postgres writes. Caller (compareOrgNexusVsMssql.ts) diffs the
 * result against the current MSSQL-derived `User` table.
 */
export async function inferOrgHierarchyFromNexus(): Promise<OrgInferenceResult> {
  const employees = await fetchAllEmployees();
  const byNip = new Map(employees.map((e) => [e.nip, e]));

  // Field Force is a leaf by definition — no point calling get_subordinates for them.
  const managerCandidates = employees.filter((e) => e.position !== "Field Force");

  const failedManagerNips: string[] = [];
  const subtreeByManager = new Map<string, Set<string>>(); // manager nip -> Set<subordinate nip> (entire transitive subtree)
  await mapWithConcurrency(managerCandidates, CONCURRENCY, async (mgr) => {
    const subs = await fetchSubordinates(mgr.nip);
    if (subs === null) {
      failedManagerNips.push(mgr.nip);
      return;
    }
    subtreeByManager.set(mgr.nip, new Set(subs.map((s) => s.nip)));
  });

  // ancestors(Y) = every manager X where Y ∈ subtree(X)
  const ancestorsByNip = new Map<string, string[]>();
  for (const [mgrNip, subtree] of subtreeByManager) {
    for (const subNip of subtree) {
      const arr = ancestorsByNip.get(subNip) ?? [];
      arr.push(mgrNip);
      ancestorsByNip.set(subNip, arr);
    }
  }

  // Closest enclosing ancestor = the one with the SMALLEST subtree among Y's ancestors
  // (containment guarantees subtree(closer) ⊆ subtree(further), so smallest = nearest).
  function closestAncestor(nip: string): string | null {
    const ancestors = ancestorsByNip.get(nip);
    if (!ancestors || ancestors.length === 0) return null;
    let best: string | null = null;
    let bestSize = Infinity;
    for (const a of ancestors) {
      const size = subtreeByManager.get(a)?.size ?? Infinity;
      if (size < bestSize) { bestSize = size; best = a; }
    }
    return best;
  }

  const records: InferredOrgRecord[] = employees.map((emp) => {
    let nipAtasan = closestAncestor(emp.nip);

    // Skip-Supervisor rule (§3 step 4) — mirrors MSSQL's "SPV & FF both report
    // to ASM directly" so the approval chain doesn't change shape just
    // because the data source moved. Only ever fires for a Field Force whose
    // closest ancestor came back as a Supervisor.
    if (nipAtasan && byNip.get(nipAtasan)?.position === "Supervisor" && emp.position === "Field Force") {
      nipAtasan = closestAncestor(nipAtasan);
    }

    return {
      nip: emp.nip,
      nama: emp.nama,
      position: emp.position,
      role: POSITION_TO_ROLE[emp.position] ?? null,
      inferredNipAtasan: nipAtasan,
      inferredNamaAtasan: nipAtasan ? byNip.get(nipAtasan)?.nama ?? null : null,
    };
  });

  return { records, failedManagerNips };
}
