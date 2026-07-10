import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/authz";
import { submitPoaAction } from "@/app/actions/poa";
import { getCustomers, getProducts } from "@/lib/masterData";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LineItemEditor } from "@/components/poa/LineItemEditor";
import type { PoaLineItem } from "@prisma/client";

export const metadata = { title: "Edit POA · POA System" };

export default async function EditPoaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor, customers, products] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: { owner: true, items: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
    getCustomers(),
    getProducts(),
  ]);

  if (!poa) notFound();
  if (!canEdit(actor, poa)) redirect(`/poa/${id}`);

  const isMR = session.role === "MR";
  const submitWithId = submitPoaAction.bind(null, id);

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1>Edit POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name}
          </p>
        </div>
        <StatusBadge status={poa.status} />
      </div>

      {/* Line items editor */}
      <Card>
        <CardHeader>
          <CardTitle>Baris POA (Customer × Produk)</CardTitle>
          <Link href={`/poa/${id}`} className="text-xs" style={{ color: "var(--color-blue)" }}>
            Lihat detail →
          </Link>
        </CardHeader>
        <LineItemEditor
          poaId={id}
          initialItems={poa.items as PoaLineItem[]}
          customers={customers}
          products={products}
        />
      </Card>

      {/* Action area — different for MR vs approver */}
      <Card>
        {isMR ? (
          <>
            <CardHeader>
              <CardTitle>Submit POA</CardTitle>
            </CardHeader>
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Pastikan semua baris sudah lengkap sebelum submit ke atasan.
              POA tidak dapat diedit kembali setelah disubmit.
            </p>
            <div className="flex gap-3">
              <form action={submitWithId}>
                <Button type="submit" disabled={poa.items.length === 0}>
                  Submit ke Atasan
                </Button>
              </form>
              <Link href={`/poa/${id}`}>
                <Button variant="secondary" type="button">Lihat Draft</Button>
              </Link>
            </div>
            {poa.items.length === 0 && (
              <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                Tambahkan minimal satu baris sebelum submit.
              </p>
            )}
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Selesai Mengedit</CardTitle>
            </CardHeader>
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Perubahan tersimpan otomatis. Kembali ke halaman detail untuk melakukan approve atau forward.
            </p>
            <Link href={`/poa/${id}`}>
              <Button>Kembali ke Detail</Button>
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}
