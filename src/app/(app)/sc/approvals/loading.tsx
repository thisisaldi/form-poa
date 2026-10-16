export default function ScApprovalsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-64 rounded" style={{ background: "var(--color-bg-subtle)" }} />
        <div className="h-4 w-96 max-w-full rounded" style={{ background: "var(--color-bg-subtle)" }} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg" style={{ background: "var(--color-bg-subtle)" }} />
        ))}
      </div>
      <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--color-border)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded" style={{ background: "var(--color-bg-subtle)" }} />
        ))}
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>Memuat persetujuan Sales Counter…</p>
    </div>
  );
}
