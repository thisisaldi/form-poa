import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOutletsForSurveyUpload } from "@/lib/masterData";
import { SurveyUploadForm } from "@/components/poa/SurveyUploadForm";

export const metadata = { title: "Input Data Survey · Form POA" };

// Widened from MR-only v1 to the whole sales chain + ADMIN testing
// (2026-08-10 — lihat docs/survey-pasien-features/03-ui-and-access.md §5).
const ALLOWED_ROLES = ["MR", "ASM", "SM", "NSM", "ADMIN"];

export default async function SurveyUploadPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.role)) redirect("/dashboard");

  const outlets = await getOutletsForSurveyUpload(session);

  return (
    <SurveyUploadForm
      outlets={outlets
        .filter((o): o is typeof o & { kodePI: string } => !!o.kodePI)
        .map((o) => ({ kodePI: o.kodePI, namaOutlet: o.namaOutlet }))}
    />
  );
}
