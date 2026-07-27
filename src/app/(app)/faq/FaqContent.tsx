"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

// ─── Content primitives ───────────────────────────────────────────────────────

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <code className="block font-mono text-xs px-2.5 py-1.5 rounded overflow-x-auto whitespace-pre"
      style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
      {children}
    </code>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm px-3 py-2.5 rounded-md my-2"
      style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
      <span aria-hidden style={{ color: "var(--color-warning)" }}>ⓘ</span>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Ladder({ steps }: { steps: React.ReactNode[] }) {
  return (
    <div className="rounded-md overflow-hidden my-2" style={{ border: "1px solid var(--color-border)" }}>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm"
          style={{
            background: "var(--color-surface)",
            color: "var(--color-text-muted)",
            borderBottom: i < steps.length - 1 ? "1px solid var(--color-border)" : undefined,
          }}>
          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
            style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
            {i + 1}
          </span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.85em] px-1 py-0.5 rounded"
      style={{ background: "var(--color-blue-light)", color: "var(--color-blue)" }}>
      {children}
    </code>
  );
}

const B = ({ children }: { children: React.ReactNode }) => (
  <strong style={{ color: "var(--color-text)" }}>{children}</strong>
);

// ─── FAQ data ─────────────────────────────────────────────────────────────────
// Only the non-obvious stuff — anything a glance at the column name already
// explains (Customer = 1, PIC = nama MR, dst) is deliberately left out.

interface FaqItem {
  q: string;
  a: React.ReactNode;
  /** Extra words the search should also match against, beyond the question text. */
  keywords?: string;
}

interface FaqSection {
  id: string;
  title: string;
  items: FaqItem[];
}

const SECTIONS: FaqSection[] = [
  {
    id: "ringkasan",
    title: "Ringkasan (kartu atas)",
    items: [
      {
        q: "Kenapa \"Estimasi POA\" kadang berubah jadi \"Estimasi Aktif+Pengajuan\"?",
        keywords: "estimasi aktif pengajuan headline judul",
        a: (
          <>
            <p>Kalau ada kontrak PSSP yang masih aktif di outlet-outlet yang tercakup, judulnya berubah dan angkanya
              menggabungkan estimasi kontrak aktif dengan estimasi pengajuan, plus rincian &ldquo;Aktif ... ·
              Pengajuan ...&rdquo; di bawah angkanya. Kalau tidak ada kontrak aktif sama sekali, tetap tampil
              &ldquo;Estimasi POA&rdquo; seperti biasa (cuma pengajuan).</p>
            <Formula>Σ rencanaTotalBiaya (pengajuan) + Σ estBaris (kontrak PSSP aktif)</Formula>
          </>
        ),
      },
      {
        q: "Growth YTD / Achievement YTD+Est dihitungnya gimana, kok bisa beda dari yang saya kira?",
        keywords: "growth achievement ytd average rata-rata",
        a: (
          <>
            <p>Bukan rata-rata persentase tiap outlet/customer/dsb — itu bisa melenceng jauh dari angka Rupiah yang
              sama-sama ditampilkan di kartu yang sama kalau ukuran tiap grup beda-beda jauh. Jumlah dulu semua
              komponennya lintas grup, baru dibagi (growth-of-totals).</p>
            <Formula>{"Growth YTD = (ΣSales YTD − ΣSales YTD tahun lalu) ÷ ΣSales YTD tahun lalu × 100%"}</Formula>
            <Formula>{"Achievement = Σ(Sales YTD+Est) ÷ Σ(Historis Tahun Lalu ÷ 12 × bulan berjalan) × 100%"}</Formula>
          </>
        ),
      },
      {
        q: "Apa bedanya \"Sudah listing\", \"Proses\", dan \"Belum\" di Listing Produk?",
        keywords: "listing produk standarisasi sudah proses belum",
        a: (
          <>
            <p><B>Sudah listing</B> = kode produk unik dengan status Listing Corporate <InlineCode>SUDAH_STANDARISASI</InlineCode>.
              <B> Proses</B> = berstatus <InlineCode>PROSES_PENGAJUAN</InlineCode>, dikurangi yang sudah kehitung di
              &ldquo;Sudah listing&rdquo; supaya satu produk tidak dobel-hitung. <B>Belum</B> = sisanya.</p>
            <Formula>Belum = totalUniqueProducts − Sudah listing</Formula>
          </>
        ),
      },
      {
        q: "Kenapa Data Sales gak muncul di tab Per Customer & Per Produk?",
        keywords: "data sales dir10001b outlet customer produk hilang",
        a: (
          <p>Sumbernya DIR10001B (<InlineCode>OutletSalesValueMonthly</InlineCode>), yang cuma level outlet — tidak
            ada breakdown per Customer atau per Produk, jadi kartunya disembunyikan di dua tab itu.</p>
        ),
      },
    ],
  },
  {
    id: "outlet",
    title: "Tab Per Outlet",
    items: [
      {
        q: "Apa itu \"User PSSP (Aktif+Estimasi)\"?",
        keywords: "user pssp aktif estimasi union customer unik",
        a: <p>Jumlah customer unik yang punya kontrak PSSP aktif ATAU sudah ada di pengajuan draft — digabung jadi
          satu (union), jadi customer yang ada di keduanya cuma dihitung sekali.</p>,
      },
      {
        q: "Kenapa Gap bisa merah?",
        keywords: "gap merah realisasi sebelumnya warning",
        a: (
          <>
            <p>Gap = Estimasi sekarang dikurangi Realisasi Sebelumnya (total yang pernah benar-benar lunas dibayar
              di outlet ini, dari semua kontrak PSSP baik yang sudah kelar maupun yang masih jalan). Merah kalau
              positif — sinyal &ldquo;dulu realisasinya segini, kok sekarang estimasinya jauh lebih tinggi&rdquo;,
              perlu dicek kewajarannya.</p>
            <Formula>Gap = Estimasi − Realisasi Sebelumnya</Formula>
          </>
        ),
      },
      {
        q: "Kenapa Cost Ratio persentasenya beda dari yang saya kira?",
        keywords: "cost ratio persen budget estimasi pengajuan",
        a: <p>Basisnya Estimasi <B>pengajuan saja</B>, bukan angka gabungan Aktif+Pengajuan yang jadi headline baris
          ini.</p>,
      },
      {
        q: "Kenapa Listing Fee di outlet ini gak naik meski produknya banyak?",
        keywords: "listing fee kontrak duplikat dobel hitung",
        a: <p>Satu kontrak Listing Fee dengan banyak produk cuma dihitung sekali nilainya (dedup per kontrak),
          tidak dikali jumlah produk di dalamnya.</p>,
      },
      {
        q: "Bagaimana cara baca \"Pelunasan (%) Running Rate\"?",
        keywords: "pelunasan running rate warna hijau kuning merah",
        a: (
          <>
            <p>Bukan progres dari 0–100%, tapi progres relatif ke seberapa jauh periode kontraknya sudah berjalan —
              apakah pelunasan kontrak PSSP aktif di outlet ini sesuai target di titik waktu sekarang.</p>
            <Formula>Σ totalLunas AKTUAL ÷ Σ (estBaris × fraksi waktu kontrak berjalan) × 100%</Formula>
            <p>≥100% <span style={{ color: "var(--color-success, #16a34a)" }}>(hijau)</span> = sesuai/lebih cepat.
              70–99% <span style={{ color: "var(--color-warning)" }}>(kuning)</span> = agak lambat.
              &lt;70% <span style={{ color: "var(--color-red)" }}>(merah)</span> = tertinggal jauh.</p>
          </>
        ),
      },
    ],
  },
  {
    id: "customer",
    title: "Tab Per Customer",
    items: [
      {
        q: "Kenapa Estimasi di tab Customer beda dari tab Outlet?",
        keywords: "estimasi customer outlet aktif pengajuan",
        a: <p>Tab Customer cuma menjumlah rencana biaya pengajuan customer ini — tidak digabung dengan nilai
          kontrak PSSP aktif seperti tab Outlet, karena kontrak aktif tidak dipetakan per customer di tab ini.</p>,
      },
      {
        q: "Kenapa angka \"Listing\" per baris bisa beda dari total \"Listing Produk\" di kartu Ringkasan?",
        keywords: "listing per baris vs global unik dedup",
        a: (
          <>
            <p>Beda populasi, bukan salah hitung: Ringkasan menghitung produk unik lintas SEMUA baris (dedup
              global), sedangkan kolom ini cuma baris pengajuan customer ini sendiri.</p>
            <Formula>Listing (per baris) = terstandarisasi ÷ pengajuan (baris customer ini saja)</Formula>
          </>
        ),
      },
    ],
  },
  {
    id: "produk",
    title: "Tab Per Produk",
    items: [
      {
        q: "Kenapa kontrak PSSP dicocokkan pakai nama produk, bukan kode produk?",
        keywords: "kode produk nama kdproduk namespace beda sistem",
        a: <p>Kode produk di sistem PSSP (<InlineCode>kdProduk</InlineCode>) itu namespace yang berbeda dari kode
          produk internal (<InlineCode>kodeProduk</InlineCode>) — jadi pencocokan aktif PSSP di tab ini pakai nama
          produk yang dinormalisasi, bukan kode.</p>,
      },
      {
        q: "Kenapa \"Sales Aktif\" di tab Produk beda cara hitung dari tab Outlet?",
        keywords: "sales aktif produk outlet qty hna derivasi rupiah",
        a: (
          <>
            <p>Tab Outlet pakai angka Rupiah riil dari DIR10001B. Tab Produk <B>tidak punya</B> sumber Rupiah
              per-produk, jadi ini angka turunan (derivasi): kuantitas terjual sejak Jan 2026 dikali HNA produk —
              bukan Rupiah yang benar-benar tercatat.</p>
            <Formula>Sales Aktif (produk) = qty terjual × HNA</Formula>
          </>
        ),
      },
      {
        q: "Apa itu AVG ST/Pasien?",
        keywords: "avg st pasien rata-rata satuan terkecil",
        a: (
          <>
            <p>Rata-rata dari rasio per baris (qty ÷ pasien tiap baris), <B>bukan</B> total qty dibagi total pasien
              — dua cara hitung ini bisa kasih angka beda kalau volumenya timpang antar baris.</p>
            <Formula>rata-rata dari (qtyProdukResep ÷ jumlahPasienHari)</Formula>
          </>
        ),
      },
    ],
  },
  {
    id: "personil",
    title: "Tab Per Personil",
    items: [
      {
        q: "Kenapa gak ada Realisasi Sebelumnya di tab Per Personil?",
        keywords: "realisasi sebelumnya personil mr gap kosong",
        a: <p>Belum ada agregasi realisasi per-MR di sistem. Kolom lainnya (Estimasi, Customer, Produk Fokus,
          Pengajuan, % Budget, Listing) pakai rumus persis sama seperti tab Per Customer, cuma digabung per-MR
          bukan per-dokter.</p>,
      },
    ],
  },
  {
    id: "sorting",
    title: "Urutan (Sorting)",
    items: [
      {
        q: "Bagaimana urutan \"GAP Tertinggi\" bekerja di tab Outlet & Customer?",
        keywords: "sorting urutan gap tertinggi pssp aktif retensi",
        a: (
          <>
            <p>Toggle ini cuma muncul di tab Outlet &amp; Customer — dua tab lain selalu urut Estimasi tertinggi,
              tidak bisa diganti. Kriterianya beda di masing-masing tab:</p>
            <p className="font-medium" style={{ color: "var(--color-text)" }}>Tab Outlet:</p>
            <Ladder steps={[
              <>Outlet dengan <B>PSSP Aktif</B> (estimasiAktif &gt; 0) selalu di atas yang tidak punya.</>,
              <>Di antara sesama PSSP Aktif: urut <B>Gap tertinggi</B> ke rendah.</>,
              <>Sisanya: urut <B>Estimasi tertinggi</B> ke rendah.</>,
            ]} />
            <p className="font-medium" style={{ color: "var(--color-text)" }}>Tab Customer:</p>
            <Ladder steps={[
              <>Customer dengan <B>Realisasi Sebelumnya &gt; 0</B> selalu di atas yang belum pernah ada realisasi.</>,
              <>Di antara yang ada realisasi: urut <B>Gap tertinggi</B> ke rendah.</>,
              <>Sisanya: urut <B>Estimasi tertinggi</B> ke rendah.</>,
            ]} />
            <Note>
              <p>Outlet pakai kriteria &ldquo;PSSP Aktif&rdquo; (kontrak yang masih berjalan), Customer pakai
                &ldquo;Realisasi Sebelumnya&rdquo; (duit yang pernah lunas) — beda karena tab Outlet punya data
                kontrak aktif yang tab Customer tidak punya.</p>
            </Note>
          </>
        ),
      },
      {
        q: "Apa bedanya dengan \"Estimasi Tertinggi\"?",
        keywords: "estimasi tertinggi sort polos",
        a: <p>Sort polos — semua baris diurutkan dari Estimasi terbesar ke terkecil, tanpa mempedulikan
          Realisasi/PSSP Aktif sama sekali.</p>,
      },
    ],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD");
}

function matches(item: FaqItem, query: string): boolean {
  if (!query) return true;
  const haystack = normalize(`${item.q} ${item.keywords ?? ""}`);
  return haystack.includes(query);
}

function FaqEntry({ item }: { item: FaqItem }) {
  return (
    <div className="py-3.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
      <p className="text-sm font-semibold mb-1.5" style={{ color: "var(--color-text)" }}>{item.q}</p>
      <div className="text-sm space-y-1.5 max-w-[68ch]" style={{ color: "var(--color-text-muted)" }}>{item.a}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FaqContent() {
  const [query, setQuery] = useState("");

  const filteredSections = useMemo(() => {
    const q = normalize(query.trim());
    return SECTIONS
      .map((s) => ({ ...s, items: s.items.filter((it) => matches(it, q)) }))
      .filter((s) => s.items.length > 0);
  }, [query]);

  const totalCount = SECTIONS.reduce((s, sec) => s + sec.items.length, 0);
  const shownCount = filteredSections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1>FAQ</h1>
        <p className="mt-1 text-sm max-w-[68ch]" style={{ color: "var(--color-text-muted)" }}>
          Pertanyaan yang sering muncul soal angka-angka di halaman <Link href="/summary">Summary</Link> — cuma yang
          gak kelihatan jelas dari nama kolomnya saja.
        </p>
      </div>

      <div className="sticky top-0 z-10" style={{ background: "var(--color-bg)" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari pertanyaan… (mis. gap, running rate, sales aktif)"
          className="input-field w-full"
          aria-label="Cari FAQ"
        />
      </div>

      {query.trim() && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {shownCount > 0 ? `${shownCount} dari ${totalCount} pertanyaan cocok.` : "Tidak ada pertanyaan yang cocok."}
        </p>
      )}

      {filteredSections.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            Tidak ketemu. Coba kata kunci lain.
          </p>
        </Card>
      ) : (
        filteredSections.map((section) => (
          <Card key={section.id}>
            <h2 id={section.id} className="scroll-mt-4 text-xs font-bold uppercase tracking-[0.14em] pb-3 mb-1"
              style={{ color: "var(--color-blue)", borderBottom: "1px solid var(--color-border)" }}>
              {section.title}
            </h2>
            {section.items.map((item, i) => (
              <FaqEntry key={i} item={item} />
            ))}
          </Card>
        ))
      )}

      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Dibuat dari pembacaan langsung <InlineCode>summary/page.tsx</InlineCode>, <InlineCode>MonitoringChecklist.tsx</InlineCode>,
        dan <InlineCode>TerritoryTable.tsx</InlineCode>. Kalau rumusnya berubah di kode, halaman ini perlu diperbarui juga.
      </p>
    </div>
  );
}
