import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { PoaAuditLog as AuditLogType, User as UserType, PoaLineItem } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canView, canEdit } from "@/lib/authz";
import { submitPoaAction, approvePoaAction } from "@/app/actions/poa";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatPeriodeRange } from "@/lib/poaUtils";
import { spesLabel } from "@/lib/spesialisasi";

export const metadata = { title: "Detail POA · POA System" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRp(n: number) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace(".", ",")} Jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function toNum(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

// ─── Stats computation ───────────────────────────────────────────────────────

function computePoaStats(items: PoaLineItem[]) {
  let estimasiTotal = 0;
  let psspTotal = 0;
  let discountTotal = 0;
  let entertainTotal = 0;

  for (const it of items) {
    const base = toNum(it.rencanaTotalBiaya);
    estimasiTotal += base;
    psspTotal += base * (toNum(it.persenPsspDokter) + toNum(it.persenPsspKpdm));
    discountTotal += base * (toNum(it.persenDiskon) + toNum(it.persenDp) + toNum(it.persenListingFee));
    entertainTotal += base * toNum(it.persenEntertain);
  }

  const budgetTotal = psspTotal + discountTotal + entertainTotal;

  const customerSet = new Set(items.map((i) => i.namaCust));
  const productSet = new Set(items.map((i) => i.kodeProduk));

  const sudah = items.filter((i) => i.statusStandarisasi === "SUDAH_STANDARISASI").length;
  const proses = items.filter((i) => i.statusStandarisasi === "PROSES_PENGAJUAN").length;
  const gap = items.length - sudah;

  return {
    estimasiTotal,
    psspTotal,
    discountTotal,
    entertainTotal,
    budgetTotal,
    customerCount: customerSet.size,
    productCount: productSet.size,
    totalPengajuan: items.length,
    sudahStandar: sudah,
    prosesStandar: proses,
    gap,
  };
}

// ─── Stats Panel ─────────────────────────────────────────────────────────────

function StatCell({
  label, value, sub, warn,
}: { label: string; value: React.ReactNode; sub?: string; warn?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>
        {label}
      </div>
      <div className="text-sm font-semibold" style={{ color: warn ? "var(--color-red, #dc2626)" : "var(--color-text)" }}>
        {value}
      </div>
      {sub && <div className="text-xs" style={{ color: "var(--color-text-faint)" }}>{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full text-xs font-semibold uppercase tracking-wider pt-1"
      style={{ color: "var(--color-text-faint)", borderTop: "1px solid var(--color-border)" }}>
      {children}
    </div>
  );
}

function PoaStats({ items }: { items: PoaLineItem[] }) {
  if (items.length === 0) return null;

  const s = computePoaStats(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ringkasan POA</CardTitle>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-faint)" }}>
          {items.length} baris
        </span>
      </CardHeader>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">

        {/* ── Estimasi ── */}
        <SectionLabel>Estimasi Penjualan</SectionLabel>
        <StatCell label="Total Estimasi" value={formatRp(s.estimasiTotal)} />
        <StatCell label="Target Area" value="—" sub="pending" />
        <StatCell label="Ratio Estimasi" value="—" sub="min 140%" />

        {/* ── Budget ── */}
        <SectionLabel>Anggaran</SectionLabel>
        <StatCell label="Biaya PSSP" value={formatRp(s.psspTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.psspTotal / s.estimasiTotal) * 100).toFixed(1)}% estimasi` : undefined} />
        <StatCell label="Discount + DPL + DPF" value={formatRp(s.discountTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.discountTotal / s.estimasiTotal) * 100).toFixed(1)}% estimasi` : undefined} />
        <StatCell label="Entertain" value={formatRp(s.entertainTotal)}
          sub={s.estimasiTotal > 0 ? `${((s.entertainTotal / s.estimasiTotal) * 100).toFixed(1)}% estimasi` : undefined} />
        <StatCell label="Total Budget" value={formatRp(s.budgetTotal)} />
        <StatCell label="Ratio Budget / Target" value="—" sub="pending" />

        {/* ── Cakupan ── */}
        <SectionLabel>Cakupan</SectionLabel>
        <StatCell label="Jumlah Customer" value={s.customerCount}
          warn={s.customerCount < 30}
          sub={s.customerCount < 30 ? "⚠ kurang dari 30" : "≥ 30 ✓"} />
        <StatCell label="Variasi Produk" value={`${s.productCount} / 22`}
          warn={s.productCount < 22}
          sub={s.productCount < 22 ? `gap ${22 - s.productCount} produk` : "target terpenuhi ✓"} />
        <StatCell label="Total Pengajuan" value={s.totalPengajuan} />

        {/* ── Standarisasi ── */}
        <SectionLabel>Standarisasi / Listing</SectionLabel>
        <StatCell label="Sudah Listing" value={s.sudahStandar}
          sub={`${s.totalPengajuan > 0 ? ((s.sudahStandar / s.totalPengajuan) * 100).toFixed(0) : 0}% dari total`} />
        <StatCell label="Proses Pengajuan" value={s.prosesStandar} />
        <StatCell label="Gap (Belum)" value={s.gap} warn={s.gap > 0}
          sub={s.gap > 0 ? "perlu distandarisasi" : "semua listing ✓"} />

        {/* ── Sales (pending) ── */}
        <SectionLabel>Data Sales</SectionLabel>
        <StatCell label="Historis 2025" value="—" sub="pending data" />
        <StatCell label="Sales YTD 2026" value="—" sub="pending data" />
        <StatCell label="Sales YTD + Estimasi" value="—" sub="pending data" />
        <StatCell label="Growth YTD" value="—" sub="pending data" />
        <StatCell label="Achievement YTD + Est" value="—" sub="pending data" />
      </div>
    </Card>
  );
}

export default async function PoaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { id } = await params;
  const [poa, actor] = await Promise.all([
    prisma.poaForm.findUnique({
      where: { id },
      include: {
        owner: true,
        currentHolder: true,
        items: { orderBy: { createdAt: "asc" } },
        auditLogs: {
          include: { actor: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.user.findUniqueOrThrow({ where: { nip: session.userId } }),
  ]);

  if (!poa) notFound();

  const hasAccess = await canView(actor, poa);
  if (!hasAccess) redirect("/dashboard");

  const userCanEdit = canEdit(actor, poa);
  const submitWithId = submitPoaAction.bind(null, id);
  const approveWithId = approvePoaAction.bind(null, id);

  const isApprover = ["ASM", "SM", "NSM"].includes(session.role);
  const isFullyApproved = poa.status === "APPROVED_BY_NSM";
  const isDraft = poa.status === "DRAFT";

  const allItems = (poa as typeof poa & { items: PoaLineItem[] }).items;

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1>Detail POA</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Periode {poa.period} · {poa.owner.name} ({poa.owner.nip})
          </p>
        </div>
        <StatusBadge status={poa.status} />
      </div>

      {/* Meta */}
      <Card>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>MR</dt>
            <dd className="mt-0.5 font-medium" style={{ color: "var(--color-text)" }}>{poa.owner.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>NIP</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.owner.nip}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Periode</dt>
            <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>{poa.period}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Status</dt>
            <dd className="mt-0.5"><StatusBadge status={poa.status} /></dd>
          </div>
          {poa.currentHolder && (
            <div className="col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--color-text-faint)" }}>Pemegang saat ini</dt>
              <dd className="mt-0.5" style={{ color: "var(--color-text)" }}>
                {poa.currentHolder.name} ({poa.currentHolder.role})
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Stats summary */}
      <PoaStats items={allItems} />

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle>Baris POA</CardTitle>
          <div className="flex gap-2">
            {userCanEdit && (
              <Link href={`/poa/${id}/edit`}>
                <Button size="sm" variant="secondary">Edit</Button>
              </Link>
            )}
            {!isDraft ? (
              <a href={`/api/poa/${id}/export`}>
                <Button size="sm" variant="ghost">↓ Export Excel</Button>
              </a>
            ) : (
              <span className="text-xs px-3 py-1.5 rounded"
                style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}>
                Export tersedia setelah submit
              </span>
            )}
          </div>
        </CardHeader>
        {allItems.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
            Belum ada baris.{userCanEdit && " Klik Edit untuk menambahkan."}
          </p>
        ) : (
          <LineItemsTable items={allItems} />
        )}
      </Card>

      {/* Actions */}
      {userCanEdit && !isFullyApproved && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isApprover ? "Tindakan Persetujuan" : "Submit"}
            </CardTitle>
          </CardHeader>
          <div className="flex gap-3">
            {isApprover ? (
              <>
                <form action={approveWithId}>
                  <Button type="submit" style={{ background: "var(--color-green)" }}>
                    Approve
                  </Button>
                </form>
                <form action={submitWithId}>
                  <Button type="submit">Submit ke Atas</Button>
                </form>
              </>
            ) : (
              <form action={submitWithId}>
                <Button type="submit">Submit ke Atasan</Button>
              </form>
            )}
          </div>
        </Card>
      )}

      {isFullyApproved && (
        <div
          className="rounded-md px-4 py-3 text-sm font-medium"
          style={{ background: "var(--color-green-light)", color: "var(--color-green)" }}
        >
          POA ini telah sepenuhnya disetujui oleh NSM.
        </div>
      )}

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Aktivitas</CardTitle>
        </CardHeader>
        {poa.auditLogs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Belum ada aktivitas.</p>
        ) : (
          <ol className="relative space-y-4 pl-5 border-l" style={{ borderColor: "var(--color-border)" }}>
            {(poa.auditLogs as (AuditLogType & { actor: UserType })[]).map((log) => (
              <li key={log.id} className="relative">
                <span
                  className="absolute left-[-1.4rem] mt-1 h-2.5 w-2.5 rounded-full border-2 border-white"
                  style={{ background: "var(--color-blue)" }}
                />
                <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
                  {new Date(log.createdAt).toLocaleString("id-ID")}
                </p>
                <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  {log.actor.name}
                  <span className="ml-1.5 font-normal" style={{ color: "var(--color-text-muted)" }}>
                    {log.action.toLowerCase()}
                  </span>
                </p>
                {log.toStatus && (
                  <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    → {log.toStatus.replace(/_/g, " ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

const STATUS_STANDARISASI_LABELS: Record<string, string> = {
  SUDAH_STANDARISASI: "Sudah",
  PROSES_PENGAJUAN: "Proses",
  BELUM_STANDARISASI: "Belum",
};

function LineItemsTable({ items }: { items: PoaLineItem[] }) {
  // Group by kodeRequest
  const groups = new Map<string, PoaLineItem[]>();
  for (const item of items) {
    const key = item.kodePI ?? item.kodeRequest ?? item.id;
    const g = groups.get(key) ?? [];
    g.push(item);
    groups.set(key, g);
  }

  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([kodeRequest, rows]) => {
        const first = rows[0];
        return (
          <div
            key={kodeRequest}
            className="rounded-md border overflow-hidden"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="px-4 py-2 text-xs font-semibold uppercase tracking-wide"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}
            >
              {first.kodeRequest} · {first.namaCust} · {spesLabel(first.spesialisasi)} · {first.namaOutlet}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Produk</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Periode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Estimasi</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Visit/Minggu</th>
                  <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--color-text-faint)" }}>Standarisasi</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium" style={{ color: "var(--color-text)" }}>{item.namaProduk}</p>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{item.kodeProduk}</p>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>
                      {formatPeriodeRange(item.periodeAwal, item.lamaPeriode)}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>
                      Rp {parseInt(item.rencanaTotalBiaya.toString()).toLocaleString("id-ID")}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text)" }}>{item.rencanaVisitMinggu}×</td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {item.statusStandarisasi ? STATUS_STANDARISASI_LABELS[item.statusStandarisasi] : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
