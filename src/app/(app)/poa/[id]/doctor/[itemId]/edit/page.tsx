import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEditDoctor, canView } from "@/lib/authz";
import { getProducts } from "@/lib/masterData";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/Card";
import { EditDoctorPanel } from "@/components/poa/LineItemEditor";

export const metadata = { title: "Edit Rencana POA · Form POA" };

export default async function EditDoctorPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id, itemId } = await params;
  const [poa, actor, products, anchorItem] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id }, include: { owner: true } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
    getProducts(),
    prisma.poaLineItem.findUnique({ where: { id: itemId } }),
  ]);

  if (!poa || !anchorItem || anchorItem.poaId !== id) notFound();

  // Same-doctor group: all line items sharing this outlet + customer name (mirrors DraftChecklist's doctorKey).
  const [items, doctorApproval] = await Promise.all([
    prisma.poaLineItem.findMany({
      where: { poaId: id, kodePI: anchorItem.kodePI, namaCust: anchorItem.namaCust },
      orderBy: { createdAt: "asc" },
    }),
    anchorItem.kodePI
      ? prisma.poaDoctorApproval.findUnique({
          where: { poaId_kodePI_namaCust: { poaId: id, kodePI: anchorItem.kodePI, namaCust: anchorItem.namaCust } },
        })
      : Promise.resolve(null),
  ]);

  // Per-doctor edit rights (2026-08-18 fix) — this page already scopes the
  // FORM to just this one doctor's line items, but the permission check was
  // still canEdit(actor, poa), the whole-draft rollup. That meant a doctor
  // legitimately still editable (e.g. sitting in REVISI, or never submitted
  // this cycle) could be blocked because SOME OTHER doctor in the same draft
  // had moved further along in approval — and vice versa. canEditDoctor
  // reads this doctor's own PoaDoctorApproval row instead.
  const userCanEdit = await canEditDoctor(actor, poa, doctorApproval);
  // Anyone who can VIEW this POA (not just edit it) can open this page too —
  // read-only (all fields disabled via fieldset, no Simpan button) rather
  // than redirected back to the lightweight checklist summary (2026-07-31:
  // VIEWER/GM/SFE need the SAME full per-product detail an editor sees —
  // Histori PSSP, Kriteria Produk, every field — not just a summary table).
  if (!userCanEdit && !(await canView(actor, poa))) redirect(`/poa/${id}`);

  const backUrl = `/poa/${id}`;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href={backUrl} className="text-xs mb-1 inline-flex items-center gap-1"
            style={{ color: "var(--color-text-faint)" }}>
            ← Kembali ke Draft
          </Link>
          <h1>{userCanEdit ? "Edit Rencana POA" : "Detail Rencana POA"}</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name}
            {!userCanEdit && <span style={{ color: "var(--color-text-faint)" }}> · Mode lihat saja</span>}
          </p>
        </div>
        <StatusBadge status={poa.status} version={poa.version} />
      </div>

      <Card>
        <EditDoctorPanel
          items={items}
          poaId={id}
          poaPeriod={poa.period}
          products={products}
          redirectTo={backUrl}
          readOnly={!userCanEdit}
        />
      </Card>
    </div>
  );
}
