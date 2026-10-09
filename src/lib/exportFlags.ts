// Temporary kill switches for Excel exports (OOM in production — each export
// builds the whole workbook + Buffer in memory). Set a flag to false to
// re-enable the matching routes and buttons.

// POA Sales Counter: /api/sc/export, /api/sc/[id]/export
export const SC_EXPORT_DISABLED = true;
export const SC_EXPORT_DISABLED_MESSAGE =
  "Export Excel POA Sales Counter dinonaktifkan sementara. Silakan coba lagi nanti.";

// POA Hospital (Form POA): /api/poa/[id]/export, /api/export/team
export const POA_EXPORT_DISABLED = true;
export const POA_EXPORT_DISABLED_MESSAGE =
  "Export Excel POA dinonaktifkan sementara. Silakan coba lagi nanti.";
