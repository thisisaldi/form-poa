import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BlastInBadge, InsScBadge } from "@/components/ui/BlastInBadge";
import { SalesCounterEditByIdEditor } from "@/components/sc/edit/SalesCounterEditByIdEditor";
import { getSalesCounterFormById } from "./_services/getSalesCounterFormById";

export const metadata = { title: "Edit Rencana POA Sales Counter · Form POA" };

export default async function EditSalesCounterByIdPage({
  params,
}: {
  params: Promise<{ id: string; scId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id: period, scId } = await params;

  const data = await getSalesCounterFormById(scId, session.userId, session.role);
  if (!data) notFound();

  const { form, products, userCanEdit, isOwner } = data;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link
          href={`/sc/${scId}`}
          className="text-xs mb-1 inline-flex items-center gap-1"
          style={{ color: "var(--color-text-faint)" }}
        >
          ← Kembali ke Detail
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1>{userCanEdit ? "Edit Rencana POA Sales Counter" : "Detail Rencana POA Sales Counter"}</h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Periode {form.period} · {form.owner.name}
            </p>
            <p className="mt-0.5 text-xs flex items-center gap-1.5 flex-wrap" style={{ color: "var(--color-text-faint)" }}>
              <span>Outlet: <strong>{form.kodePI ? `${form.kodePI} · ` : ""}{form.namaOutlet || form.kodePI}</strong></span>
              {form.is_sc && <InsScBadge />}
              {form.isBlastIn && <BlastInBadge />}
              {form.persons.length > 0 && (
                <> · SC: {form.persons.map((p: { personName: string }) => p.personName).join(", ")}</>
              )}
            </p>
          </div>
          <StatusBadge status={form.status} version={form.version} />
        </div>
      </div>

      <Card>
        <SalesCounterEditByIdEditor
          scId={form.id}
          poaPeriod={form.period}
          kodePI={form.kodePI}
          namaOutlet={form.namaOutlet}
          is_sc={form.is_sc}
          isBlastIn={form.isBlastIn}
          persons={form.persons}
          initialProducts={form.products}
          initialEntertainItems={form.entertainItems}
          initialPeriodeAwal={form.periodeAwal}
          initialLamaPeriode={form.lamaPeriode}
          initialPersenResepDokter={form.persenResepDokter}
          masterProducts={products}
          readOnly={!userCanEdit}
          isOwner={isOwner}
        />
      </Card>
    </div>
  );
}
