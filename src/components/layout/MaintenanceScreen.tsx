/**
 * Full-lockout screen shown to every non-ADMIN role when MaintenanceMode is
 * enabled — rendered directly in place of the Sidebar + page content in
 * (app)/layout.tsx, so no other (app) route is reachable while it's on
 * (2026-07-31). ADMIN never sees this — they keep normal access so they can
 * flip the switch back off from /admin.
 */
export function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center px-4" style={{ background: "var(--color-bg)" }}>
      <div className="max-w-md text-center space-y-3">
        <div className="text-4xl">🛠️</div>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>Sedang Maintenance</h1>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{message}</p>
      </div>
    </div>
  );
}
