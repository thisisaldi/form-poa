// Route-level loading UI (Next.js App Router convention — automatically
// wraps page.tsx in a Suspense boundary for this route segment). Added
// 2026-08-24: this page has no internal Suspense split like
// dashboard/summary/pm-dashboard (its per-doctor approve/reject buttons are
// deep inside one large server-side computation, so splitting a "cheap
// shell" out wouldn't get the buttons showing any sooner) — reported by
// sales team as the Approve/Reject buttons appearing to be "missing" during
// the blank gap before the full page renders. This just gives that gap a
// visible loading state instead of nothing.
export default function PoaDetailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-64 rounded" style={{ background: "var(--color-bg-subtle)" }} />
        <div className="h-4 w-40 rounded" style={{ background: "var(--color-bg-subtle)" }} />
      </div>
      <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--color-border)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 rounded" style={{ background: "var(--color-bg-subtle)" }} />
        ))}
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat detail POA…</p>
    </div>
  );
}
