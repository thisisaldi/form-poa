import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseKpiPersonil } from "@/lib/kpiAccess";
import { getKpiSubordinates, lastCompletedPeriod, type KpiScheme } from "@/app/actions/kpiDetail";
import { Card } from "@/components/ui/Card";
import { KpiPeriodPicker } from "@/components/kpi/KpiPeriodPicker";
import { KpiPageNav } from "@/components/kpi/KpiPageNav";
import { periodLabel, roleLabel } from "@/components/kpi/kpiUi";
import { DECISION_LABEL, fmtDate, nf, titleCase } from "@/components/kpi/kpiFormat";
import { addMonths, periodOf } from "@/lib/nonHospitalScoring";

export const metadata = { title: "Detail KPI · Form POA" };

const SCHEMES: { key: KpiScheme; label: string }[] = [
  { key: "hospital", label: "Hospital" },
  { key: "non-hospital", label: "Non-Hospital" },
];

/**
 * Detail KPI — daftar bawahan langsung penilai (docs/kpi-monitoring/04-final-layout.md §3).
 * ADMIN dan SD melihat semua (SD hanya-baca); ASM/SM/NSM seluruh bawahan di subtree
 * (User.nipAtasan). Rantai approval: docs/kpi-monitoring/04-final-layout.md §9.
 */
export default async function KpiDetailListPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!["ADMIN", "SD", "ASM", "SM", "NSM"].filter(canUseKpiPersonil).includes(session.role)) redirect("/dashboard");
  const readOnly = session.role === "SD";

  const params = await searchParams;
  const scheme: KpiScheme = params.scheme === "non-hospital" ? "non-hospital" : "hospital";
  const now = periodOf(new Date());
  const periods = Array.from({ length: 12 }, (_, i) => addMonths(now, -i));
  const period = params.period && periods.includes(params.period) ? params.period : await lastCompletedPeriod();
  const hosp = scheme === "hospital";

  const rows = await getKpiSubordinates(scheme, period);
  const done = rows.filter((r) => r.decision).length;
  const todo = rows.filter((r) => r.act).length;
  const waiting = rows.filter((r) => r.decision && !r.fullyApproved).length;
  const pts = rows.map((r) => r.point).filter((p): p is number => p != null);
  const q = `scheme=${scheme}&period=${period}`;
  const stats: [string, string, string][] = [
    [readOnly ? "Personil diperpanjang" : "Bawahan", String(rows.length), ["ADMIN", "SD"].includes(session.role) ? "semua personil" : "di subtree Anda"],
    ["Sudah dievaluasi", `${done}/${rows.length}`, ""],
    [readOnly ? "Menunggu approval" : "Menunggu tindakan Anda", String(readOnly ? waiting : todo), readOnly ? "evaluasi belum disetujui lengkap" : "evaluasi atau approval"],
    ["Rata-rata Point", pts.length ? nf(pts.reduce((s, x) => s + x, 0) / pts.length) : "–", periodLabel(period)],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1>Detail KPI</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>Khusus atasan · bawahan langsung · point {periodLabel(period)}</p>
        </div>
        <KpiPeriodPicker periods={periods} period={period} basePath="/kpi-detail" extraQuery={`scheme=${scheme}`} />
      </div>

      <KpiPageNav current="detail" role={session.role} />

      <nav aria-label="Skema KPI" className="flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {SCHEMES.map((t) => (
          <Link key={t.key} href={`/kpi-detail?scheme=${t.key}&period=${period}`} aria-current={t.key === scheme ? "page" : undefined}
            className="-mb-px border-b-2 px-4 py-2 text-sm font-medium"
            style={{ borderColor: t.key === scheme ? "var(--color-blue)" : "transparent", color: t.key === scheme ? "var(--color-blue)" : "var(--color-text-muted)" }}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="rounded-md border px-4 py-2.5 text-sm" style={{ background: "var(--color-blue-light)", color: "var(--color-blue)", borderColor: "var(--color-border)" }}>
        🔒 Masuk sebagai <b>{session.name}</b> ({session.role}).{" "}
        {readOnly
          ? <>Akses <b>hanya-baca</b> ke seluruh {rows.length} personil; evaluasi dan approval dilakukan atasan masing-masing.</>
          : <>Halaman ini menampilkan <b>{rows.length} personil di bawah Anda</b>; personil lain tidak dapat dibuka.</>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([k, v, s]) => (
          <Card key={k} className="p-4!">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
            {s && <p className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{s}</p>}
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-2 p-5 pb-3">
          <div>
            <h2 className="text-base font-semibold">Detail KPI bawahan</h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Klik baris untuk membuka kartu detail lengkap, termasuk evaluasi perpanjangan kontrak.</p>
          </div>
          <a href={`/api/kpi-personil/export?${q}`} className="rounded-md border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--color-border)" }}>
            Export Excel · semua bawahan
          </a>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              <tr className="text-left text-xs">
                {["Personil", "Jabatan", hosp ? "Area" : "Wilayah", "Akhir kontrak", "Point", "Status data", "Rekomendasi", "Status approval"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.nip} className="border-t hover:bg-[var(--color-bg-subtle)]" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-3 py-2">
                    <Link href={`/kpi-detail/${r.nip}?${q}`} className="font-medium hover:underline">{titleCase(r.name)}</Link>
                    <span className="block text-[11px]" style={{ color: "var(--color-text-faint)" }}>{r.nip}</span>
                  </td>
                  <td className="px-3 py-2">{roleLabel(r.role, r.jabatan)}</td>
                  <td className="px-3 py-2">{r.area ?? "–"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.akhirKontrak)}</td>
                  <td className="px-3 py-2 text-lg font-bold tabular-nums">{nf(r.point)}</td>
                  <td className="px-3 py-2">
                    {r.complete
                      ? <Pill tone="ok">Lengkap</Pill>
                      : <span title={r.notes.join("; ")}><Pill tone="warn">⚠ Belum lengkap</Pill></span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.rec ? <Pill>{r.rec.months} bln · {r.rec.label}</Pill> : "–"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.decision && r.fullyApproved ? <Pill tone="ok">✓ {DECISION_LABEL[r.decision.months]}</Pill>
                      : r.decision ? <Pill tone="warn">{r.status}</Pill> : <Pill>{r.status}</Pill>}
                    {r.act && !readOnly && <> <Pill tone="warn">Perlu tindakan Anda</Pill></>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: "var(--color-text-faint)" }}>Tidak ada bawahan</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" }) {
  const style = tone === "ok" ? { background: "var(--color-green-light)", color: "#006B32" }
    : tone === "warn" ? { background: "var(--color-warning-bg)", color: "#7A5A12" }
    : { background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" };
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={style}>{children}</span>;
}
