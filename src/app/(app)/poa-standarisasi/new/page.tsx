import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOutletsByUser } from "@/lib/masterData";
import { NewPoaStandarisasiForm } from "@/components/poaStandarisasi/NewPoaStandarisasiForm";

export default async function NewPoaStandarisasiPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const outlets = await getOutletsByUser(session.userId);

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1>POA Standarisasi Baru</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Pilih outlet terlebih dahulu. Detail produk, dokter, dan estimasi diisi di halaman berikutnya.
        </p>
      </div>

      <NewPoaStandarisasiForm outletOptions={outlets.map((o) => ({ value: o.kodeRequest, label: o.namaCust }))} />
    </div>
  );
}
