import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOutletsByUser } from "@/lib/masterData";
import { SurveyUploadForm } from "@/components/poa/SurveyUploadForm";

export const metadata = { title: "Input Data Survey · Form POA" };

// MR-only v1 (2026-08-10, item #10 dari daftar 13 task baru — lihat
// docs/survey-pasien-features/03-ui-and-access.md §5).
export default async function SurveyUploadPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role !== "MR") redirect("/dashboard");

  const outlets = await getOutletsByUser(session.userId);

  return (
    <SurveyUploadForm
      outlets={outlets
        .filter((o): o is typeof o & { kodePI: string } => !!o.kodePI)
        .map((o) => ({ kodePI: o.kodePI, namaOutlet: o.namaOutlet }))}
    />
  );
}
