import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOutletsByUser, getProducts } from "@/lib/masterData";
import { NewPoaStandarisasiForm } from "@/components/poaStandarisasi/NewPoaStandarisasiForm";

export default async function NewPoaStandarisasiPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  // ADMIN-only while this feature is under review (2026-08-14), same
  // convention as /monitoring.
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [outlets, productOptions] = await Promise.all([
    getOutletsByUser(session.userId),
    getProducts(),
  ]);

  // Chain-first sort, group name shown as sublabel — same convention as the
  // outlet Combobox in POA Estimasi (LineItemEditor's isChainGroup + sublabel).
  const isChainGroup = (groupRS?: string | null) => !!groupRS && groupRS !== "NON CHAIN";
  const outletOptions = [...outlets]
    .sort((a, b) => (isChainGroup(a.groupRS) ? 0 : 1) - (isChainGroup(b.groupRS) ? 0 : 1))
    .map((o) => ({
      value: o.kodeRequest,
      label: o.namaCust,
      sublabel: o.groupRS ?? "NON CHAIN",
    }));

  return (
    <NewPoaStandarisasiForm
      outletOptions={outletOptions}
      productOptions={productOptions}
    />
  );
}
