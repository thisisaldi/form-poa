/**
 * Rantai approval KPI Personil — docs/kpi-monitoring/04-final-layout.md §9.
 * Pure logic (no I/O) so server actions and UI share one definition.
 */

export type ApprovalStep = "ASM" | "SM" | "NSM";

export const STEP_LABEL: Record<string, string> = { ASM: "ASM", SM: "SM", NSM: "NSM", SD: "Sales Director" };

/**
 * Approval chain for a personil of this role (MR/SPV and anything unknown use the full chain).
 * `present` = roles that actually exist above this person in the org (vacant levels happen —
 * a step nobody holds could never be approved, so it is dropped). Omit to get the nominal chain.
 */
export function chainFor(role: string, present?: ReadonlySet<string>): ApprovalStep[] {
  const nominal: ApprovalStep[] = role === "ASM" ? ["SM", "NSM"] : role === "SM" ? ["NSM"] : ["ASM", "SM", "NSM"];
  return present ? nominal.filter((k) => present.has(k)) : nominal;
}

/**
 * Who fills the evaluation form: SM for MR/SPV/ASM, NSM for SM. When SM is vacant the next
 * level up (NSM) fills it; null when nobody above can.
 */
export function evaluatorFor(role: string, present?: ReadonlySet<string>): "SM" | "NSM" | null {
  const preferred = role === "SM" ? "NSM" : "SM";
  if (!present || present.has(preferred)) return preferred;
  return role !== "SM" && present.has("NSM") ? "NSM" : null;
}

export type Steps = Record<string, unknown>;

export const pendingSteps = (chain: ApprovalStep[], steps: Steps): ApprovalStep[] => chain.filter((k) => !steps[k]);
export const isFullyApproved = (chain: ApprovalStep[], steps: Steps | null): boolean => !!steps && pendingSteps(chain, steps).length === 0;

export type Action = { kind: "evaluasi" | "approve"; step: ApprovalStep | null } | null;

/**
 * What the viewer may do on this personil right now. `steps` = null → not
 * evaluated yet. SD (and any other role) is read-only. ADMIN overrides:
 * evaluates, or approves the first pending step.
 */
export function actionFor(viewerRole: string, personRole: string, steps: Steps | null, present?: ReadonlySet<string>): Action {
  const chain = chainFor(personRole, present);
  if (steps == null) {
    const ev = evaluatorFor(personRole, present);
    if (viewerRole === "ADMIN") return { kind: "evaluasi", step: ev && chain.includes(ev) ? ev : null };
    return ev && viewerRole === ev ? { kind: "evaluasi", step: chain.includes(ev) ? ev : null } : null;
  }
  const pend = pendingSteps(chain, steps);
  if (viewerRole === "ADMIN") return pend.length ? { kind: "approve", step: pend[0] } : null;
  return (chain as string[]).includes(viewerRole) && !steps[viewerRole] ? { kind: "approve", step: viewerRole as ApprovalStep } : null;
}

/** "Belum dievaluasi" · "Disetujui SM, menunggu ASM & NSM" · "Disetujui lengkap". */
export function statusText(personRole: string, steps: Steps | null, present?: ReadonlySet<string>): string {
  if (steps == null) return "Belum dievaluasi";
  const chain = chainFor(personRole, present);
  const done = chain.filter((k) => steps[k]);
  const pend = pendingSteps(chain, steps);
  if (pend.length === 0) return "Disetujui lengkap";
  return `${done.length ? `Disetujui ${done.join(" & ")}, ` : ""}menunggu ${pend.join(" & ")}`;
}
