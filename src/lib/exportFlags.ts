// Temporary kill switches for Excel exports (OOM in production — each export
// builds the whole workbook + Buffer in memory). Set a flag to false to
// re-enable the matching routes and buttons.

// POA Sales Counter: /api/sc/export, /api/sc/[id]/export
export const SC_EXPORT_DISABLED = true;
export const SC_EXPORT_DISABLED_MESSAGE =
  "Export Excel POA Sales Counter dinonaktifkan sementara. Silakan coba lagi nanti.";

// POA Hospital (Form POA): /api/poa/[id]/export, /api/export/team
// Re-enabled 2026-10-12 together with the pod memory bump (k8s/values.yaml 1Gi -> 2Gi,
// scripts/start.sh heap 896 -> 1792). Sales Counter (non-Hospital) stays disabled above.
export const POA_EXPORT_DISABLED = false;
export const POA_EXPORT_DISABLED_MESSAGE =
  "Export Excel POA dinonaktifkan sementara. Silakan coba lagi nanti.";
