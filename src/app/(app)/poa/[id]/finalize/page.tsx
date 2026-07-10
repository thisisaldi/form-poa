import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
import { submitPoaAction } from "@/app/actions/poa";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";

export const metadata = { title: "Finalisasi POA · POA System" };

/**
 * Review page shown to the MR before submitting their draft.
 * Validation logic is stubbed — TODO: validate poa.data fields once schema is defined.
 */
export default async function FinalizePoaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({ where: { id }, include: { owner: true } }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) notFound();
  if (!canEdit(actor, poa)) redirect(`/poa/${id}`);
  if (poa.status !== "DRAFT") redirect(`/poa/${id}`);

  const submitWithId = submitPoaAction.bind(null, id);

  // TODO: replace stub with real validation once form schema is known
  const validationIssues: string[] = [];
  // Example: if (!(poa.data as any).targetCalls) validationIssues.push("Target kunjungan belum diisi");
  const isValid = validationIssues.length === 0;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1>Finalisasi POA</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Tinjau kembali sebelum submit. Setelah submit, Anda tidak dapat mengedit.
        </p>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan</CardTitle>
          <StatusBadge status={poa.status} />
        </CardHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.owner.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.period}</dd>
          </div>
        </dl>
      </Card>

      {/* Validation checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Checklist Validasi</CardTitle>
        </CardHeader>
        {validationIssues.length > 0 ? (
          <ul className="space-y-2">
            {validationIssues.map((issue) => (
              <li key={issue} className="flex items-start gap-2 text-sm" style={{ color: "var(--color-error)" }}>
                <span>✗</span>
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-green)" }}>
            <span>✓</span>
            <span>
              Semua validasi terpenuhi.{" "}
              <span className="text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                (Validasi detail akan ditambahkan setelah schema form didefinisikan.)
              </span>
            </span>
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <form action={submitWithId}>
          <Button type="submit" disabled={!isValid}>
            Submit ke Atasan
          </Button>
        </form>
        <Link href={`/poa/${id}/edit`}>
          <Button variant="secondary" type="button">Kembali Edit</Button>
        </Link>
      </div>
    </div>
  );
}
