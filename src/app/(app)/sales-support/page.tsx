import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listSalesSupportMemosAction } from "@/app/actions/poaStandarisasi";
import { SalesSupportMemoTable } from "@/components/poaStandarisasi/SalesSupportMemoTable";

export const metadata = { title: "Memo SP Non Sales · Form POA" };

export default async function SalesSupportPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // Sales Support's only page — scope dibatasi ke memo (docs/sp-non-sales-memo/),
  // bukan akses POA Standarisasi umum. ADMIN bypass sama pola halaman lain.
  if (session.role !== "SALES_SUPPORT" && session.role !== "ADMIN") redirect("/dashboard");

  const rows = await listSalesSupportMemosAction();

  return (
    <div className="space-y-6">
      <div>
        <h1>Memo SP Non Sales</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Memo yang sudah digenerate MR. Unduh memo dan cek bukti standarisasinya, proses tanda tangan, lalu centang kalau sudah di-sign.
        </p>
      </div>
      <SalesSupportMemoTable rows={rows} />
    </div>
  );
}
