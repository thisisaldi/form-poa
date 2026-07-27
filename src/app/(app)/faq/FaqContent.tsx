"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

// ─── Content primitives ───────────────────────────────────────────────────────

function PartTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-[0.14em] pb-3 mb-1"
      style={{ color: "var(--color-blue)", borderBottom: "1px solid var(--color-border)" }}>
      {children}
    </h2>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm max-w-[68ch] mt-3 mb-1" style={{ color: "var(--color-text-muted)" }}>
      {children}
    </p>
  );
}

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

function Def({ name, tag, children }: { name: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-x-5 gap-y-1 py-3"
      style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        {name}
        {tag && (
          <span className="block sm:inline sm:ml-2 mt-1 sm:mt-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: "var(--color-text-faint)", border: "1px solid var(--color-border-strong)" }}>
            {tag}
          </span>
        )}
      </div>
      <div className="text-sm space-y-1.5 max-w-[62ch]" style={{ color: "var(--color-text-muted)" }}>{children}</div>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────
// Cuma istilah yang GAK umum dan/atau butuh hitungan — bukan glosarium lengkap
// tiap kolom. Nama field yang sudah jelas dari namanya sendiri (Customer,
// PIC, Pengajuan, dst.) sengaja tidak dimasukkan.

interface TermDef {
  name: string;
  tag?: string;
  /** Extra words the search should also match, beyond the term name. */
  keywords?: string;
  body: React.ReactNode;
}

interface DefSection {
  id: string;
  title: string;
  note?: React.ReactNode;
  terms: TermDef[];
  /** Rendered after the term list, always shown when the section itself is visible (e.g. Sorting's Ladder). */
  extra?: React.ReactNode;
}

const SECTIONS: DefSection[] = [
  {
    id: "ringkasan",
    title: "Summary — Ringkasan (kartu atas)",
    note: "Selalu agregat dari seluruh baris di tab yang aktif (sudah kefilter periode kalau ada filter dipilih).",
    terms: [
      {
        name: "Estimasi POA / Estimasi Aktif+Pengajuan",
        keywords: "estimasi aktif pengajuan headline judul",
        body: (
          <>
            <p>Kalau ada kontrak PSSP yang masih aktif di outlet-outlet yang tercakup, judul &amp; angkanya
              menggabungkan estimasi aktif dengan estimasi pengajuan, plus rincian &ldquo;Aktif ... ·
              Pengajuan ...&rdquo; di bawahnya. Kalau tidak ada kontrak aktif, tetap &ldquo;Estimasi POA&rdquo; biasa.</p>
            <Formula>Σ rencanaTotalBiaya (pengajuan) + Σ estBaris (kontrak PSSP aktif)</Formula>
          </>
        ),
      },
      {
        name: "Produk Fokus",
        keywords: "target 22 variasi fokus pm",
        body: (
          <>
            <p>Jumlah kode produk unik yang termasuk paket fokus PM, dari target 22 variasi. Merah kalau belum tercapai.</p>
            <Formula>unique(kodeProduk) WHERE getAllPakets(namaProduk).length &gt; 0</Formula>
          </>
        ),
      },
      {
        name: "Produk PSSP",
        keywords: "persen pssp dokter",
        body: <Formula>unique(kodeProduk) WHERE persenPsspDokter &gt; 0</Formula>,
      },
      {
        name: "PSSP (Anggaran)",
        keywords: "anggaran budget pengali nilai r",
        body: (
          <>
            <p>Total nilai PSSP dari seluruh baris — pakai <InlineCode>pengaliNilaiR</InlineCode> per-produk kalau ada override, default 1.</p>
            <Formula>Σ rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR</Formula>
          </>
        ),
      },
      {
        name: "Discount + DPL + DPF",
        keywords: "diskon dpl dpf listing fee",
        body: <Formula>Σ rencanaTotalBiaya × (persenDiskon + persenDp + persenListingFee)</Formula>,
      },
      {
        name: "Growth YTD",
        keywords: "growth ytd average rata-rata totals",
        body: (
          <>
            <p>Growth-of-totals, bukan rata-rata persentase tiap grup — kalau dirata-rata, angkanya bisa melenceng
              jauh dari angka Rupiah yang sama-sama ditampilkan di kartu ini kalau ukuran tiap grup beda jauh.</p>
            <Formula>{"(ΣSales YTD − ΣSales YTD tahun lalu) ÷ ΣSales YTD tahun lalu × 100%"}</Formula>
          </>
        ),
      },
      {
        name: "Achievement YTD+Est",
        keywords: "achievement target prorata pace",
        body: (
          <>
            <p>Sama alasannya dengan Growth YTD — dijumlah dulu antar grup, baru dibagi.</p>
            <Formula>{"Σ(Sales YTD+Est) ÷ Σ(Historis Tahun Lalu ÷ 12 × bulan berjalan) × 100%"}</Formula>
          </>
        ),
      },
      {
        name: "Belum (Listing Produk)",
        keywords: "listing produk sudah proses belum standarisasi",
        body: (
          <>
            <p><InlineCode>Sudah listing</InlineCode> = status <InlineCode>SUDAH_STANDARISASI</InlineCode>.
              <InlineCode> Proses</InlineCode> = <InlineCode>PROSES_PENGAJUAN</InlineCode> dikurangi yang sudah
              kehitung di Sudah listing (satu produk tidak dobel-hitung). <InlineCode>Belum</InlineCode> = sisanya.</p>
            <Formula>Belum = totalUniqueProducts − Sudah listing</Formula>
          </>
        ),
      },
      {
        name: "Data Sales",
        tag: "Hanya tab Outlet & Personil",
        keywords: "dir10001b sumber data sembunyi customer produk",
        body: <p>Sumbernya DIR10001B (<InlineCode>OutletSalesValueMonthly</InlineCode>), cuma level outlet — tidak
          ada breakdown per Customer/Produk, jadi kartu ini disembunyikan di dua tab itu.</p>,
      },
    ],
  },
  {
    id: "outlet",
    title: "Summary — Tab Per Outlet",
    terms: [
      {
        name: "User PSSP (Aktif+Estimasi)",
        keywords: "union customer unik aktif estimasi",
        body: <p>Jumlah customer unik yang punya kontrak PSSP aktif ATAU sudah ada di pengajuan draft — digabung
          jadi satu (union), customer yang ada di keduanya cuma dihitung sekali.</p>,
      },
      {
        name: "Gap",
        keywords: "gap merah realisasi sebelumnya",
        body: (
          <>
            <p>Merah kalau positif — sinyal &ldquo;dulu realisasinya segini, kok sekarang estimasinya jauh lebih
              tinggi&rdquo;, perlu dicek kewajarannya.</p>
            <Formula>Gap = Estimasi − Realisasi Sebelumnya</Formula>
          </>
        ),
      },
      {
        name: "Realisasi Sebelumnya",
        keywords: "totalLunas semua kontrak lifetime",
        body: <Formula>Σ totalLunas — semua PsspKontrak milik outlet ini (aktif maupun sudah selesai)</Formula>,
      },
      {
        name: "Cost Ratio",
        keywords: "cost ratio persen budget basis pengajuan",
        body: <p>Basisnya Estimasi <B>pengajuan saja</B>, bukan angka gabungan Aktif+Pengajuan yang jadi headline
          baris ini.</p>,
      },
      {
        name: "Listing Fee",
        keywords: "listing fee kontrak dedup dobel hitung",
        body: <p>Satu kontrak dengan banyak produk cuma dihitung sekali nilainya (dedup per kontrak), tidak dikali
          jumlah produk di dalamnya.</p>,
      },
      {
        name: "Pelunasan (%) Running Rate",
        keywords: "running rate warna hijau kuning merah fraksi waktu",
        body: (
          <>
            <p>Bukan progres 0–100%, tapi progres relatif ke seberapa jauh periode kontraknya sudah berjalan.</p>
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
    title: "Summary — Tab Per Customer & Per Produk",
    terms: [
      {
        name: "Estimasi (tab Customer)",
        keywords: "estimasi customer beda outlet",
        body: <p>Cuma rencana biaya pengajuan customer ini — tidak digabung dengan nilai kontrak PSSP aktif seperti
          tab Outlet.</p>,
      },
      {
        name: "Listing (per baris)",
        keywords: "listing baris vs global unik dedup",
        body: (
          <>
            <p>Beda populasi dari &ldquo;Listing Produk&rdquo; di kartu Ringkasan (itu dedup global lintas semua
              baris) — ini cuma baris pengajuan customer ini sendiri.</p>
            <Formula>Listing (per baris) = terstandarisasi ÷ pengajuan (baris customer ini saja)</Formula>
          </>
        ),
      },
      {
        name: "Estimasi Aktif+Pengajuan (tab Produk)",
        keywords: "produk kode nama kdproduk namespace",
        body: <p>Kontrak PSSP aktifnya dicocokkan lewat <B>nama produk</B>, bukan kode — sistem PSSP pakai
          kode produk (<InlineCode>kdProduk</InlineCode>) yang beda namespace dari kode produk internal
          (<InlineCode>kodeProduk</InlineCode>).</p>,
      },
      {
        name: "Sales Aktif (tab Produk)",
        keywords: "sales aktif qty hna derivasi rupiah",
        body: (
          <>
            <p>Beda sumber dari tab Outlet — bukan angka Rupiah riil, tapi turunan (kuantitas terjual × HNA), karena
              tidak ada sumber Rupiah asli per-produk.</p>
            <Formula>Sales Aktif (produk) = qty terjual × HNA</Formula>
          </>
        ),
      },
      {
        name: "AVG ST/Pasien",
        keywords: "avg st pasien rata-rata satuan terkecil",
        body: (
          <>
            <p>Rata-rata dari rasio TIAP BARIS (qty ÷ pasien), <B>bukan</B> total qty dibagi total pasien.</p>
            <Formula>rata-rata dari (qtyProdukResep ÷ jumlahPasienHari)</Formula>
          </>
        ),
      },
    ],
  },
  {
    id: "sorting",
    title: "Summary — Urutan (Sorting)",
    note: "Toggle “GAP Tertinggi / Estimasi Tertinggi” cuma muncul di tab Outlet & Customer — dua tab lain selalu urut Estimasi tertinggi.",
    terms: [],
    extra: (
      <>
        <p className="text-sm font-medium mt-2" style={{ color: "var(--color-text)" }}>GAP Tertinggi — tab Outlet</p>
        <Ladder steps={[
          <>Outlet dengan <B>PSSP Aktif</B> (estimasiAktif &gt; 0) selalu di atas yang tidak punya.</>,
          <>Di antara sesama PSSP Aktif: urut <B>Gap tertinggi</B> ke rendah.</>,
          <>Sisanya: urut <B>Estimasi tertinggi</B> ke rendah.</>,
        ]} />
        <p className="text-sm font-medium mt-4" style={{ color: "var(--color-text)" }}>GAP Tertinggi — tab Customer</p>
        <Ladder steps={[
          <>Customer dengan <B>Realisasi Sebelumnya &gt; 0</B> selalu di atas yang belum pernah ada realisasi.</>,
          <>Di antara yang ada realisasi: urut <B>Gap tertinggi</B> ke rendah.</>,
          <>Sisanya: urut <B>Estimasi tertinggi</B> ke rendah.</>,
        ]} />
        <Note>
          <p>Outlet pakai kriteria &ldquo;PSSP Aktif&rdquo; (kontrak yang masih berjalan), Customer pakai
            &ldquo;Realisasi Sebelumnya&rdquo; (duit yang pernah lunas) — beda karena tab Outlet punya data kontrak
            aktif yang tab Customer tidak punya. &ldquo;Estimasi Tertinggi&rdquo; sendiri sort polos, tanpa
            mempedulikan Gap/PSSP Aktif sama sekali.</p>
        </Note>
      </>
    ),
  },
  {
    id: "dokter",
    title: "Form Dokter — Rencana PSSP",
    note: "Istilah-istilah di kartu kalkulator per-produk dan panel Histori PSSP saat mengisi rencana per dokter.",
    terms: [
      {
        name: "Growth Estimasi",
        keywords: "growth estimasi pssp lama per produk total",
        body: (
          <>
            <p>Rencana estimasi bulan ini (baris yang lagi diisi) dibanding kontrak PSSP TERAKHIR untuk produk yang
              sama (aktif ataupun sudah kedaluwarsa, dicocokkan lewat nama produk) — nilai kontrak itu diratakan per
              bulan dari total periodenya sendiri (bukan estimasi baru dibagi 3, dst). Kalau belum pernah ada PSSP
              untuk produk ini, tidak ada angka growth (&ldquo;Belum ada data PSSP&rdquo;).</p>
            <Formula>{"Growth Estimasi = (Estimasi baru/bln ÷ Estimasi PSSP lama/bln − 1) × 100%"}</Formula>
            <p>Kartu &ldquo;Total Semua Produk&rdquo; menjumlah versi ini lintas semua produk yang diisi di form —
              tapi produk yang <B>belum pernah</B> ada PSSP-nya cuma menyumbang ke pembilang (estimasi barunya),
              tidak ke penyebut (PSSP lama), jadi kalau banyak produk baru di form yang sama, persentase total bisa
              kelihatan lebih tinggi dari kenyataan per-produknya.</p>
          </>
        ),
      },
      {
        name: "Growth Pelunasan (3 Bln Terakhir)",
        keywords: "growth pelunasan aktual elapsed running rate label",
        body: (
          <>
            <p>Meski labelnya bilang &ldquo;3 Bln Terakhir&rdquo;, rumusnya <B>sudah tidak</B> pakai jendela 3 bulan
              tetap — baseline-nya kontrak PSSP terakhir untuk produk ini yang benar-benar ada pelunasannya, dibagi
              berapa bulan kontrak itu SUDAH berjalan (elapsed), bukan dibagi 3 rata. Kontrak yang baru jalan 1 bulan
              tidak akan didilusi seolah sudah 3 bulan.</p>
            <Formula>Growth Pelunasan = (Estimasi baru/bln ÷ (totalLunas kontrak terakhir ÷ bulan berjalan) − 1) × 100%</Formula>
          </>
        ),
      },
      {
        name: "Retensi",
        tag: "dua arti berbeda",
        keywords: "retensi dokter kontrak quarter badge label customer",
        body: (
          <>
            <p><B>Di badge Label Customer</B> (atas form, setelah pilih dokter): berarti dokter ini punya
              MINIMAL SATU kontrak PSSP yang masih aktif sekarang, titik — tidak peduli kapan kontraknya berakhir.</p>
            <p><B>Di badge oranye pada kartu kontrak</B> (panel Histori PSSP) dan tag di dropdown pilih dokter: arti
              lebih sempit — kontrak itu aktif DAN berakhir (<InlineCode>prdAkhir</InlineCode>) di salah satu bulan
              quarter kalender yang sedang berjalan, jadi butuh perhatian perpanjangan sebelum quarter tutup.</p>
            <p>Dokter bisa kena label &ldquo;Retensi&rdquo; (badge atas) tanpa kontraknya kena badge oranye
              &ldquo;Retensi&rdquo; di kartu kontrak — dua hal beda, sama-sama pakai kata &ldquo;Retensi&rdquo;.</p>
          </>
        ),
      },
      {
        name: "Pernah PSSP",
        tag: "dua rentang beda",
        keywords: "pernah pssp label customer product tag 3 bulan lifetime",
        body: (
          <>
            <p><B>Di badge Label Customer:</B> dokter punya histori PSSP tapi TIDAK ada yang aktif sekarang.
              Persentase pelunasan di sampingnya (kalau ada &ldquo;, Pelunasan Bagus&rdquo;) dihitung dari SELURUH
              kontrak sepanjang waktu (lifetime), bukan cuma yang terakhir.</p>
            <p><B>Di tag produk pada dropdown pilih produk:</B> persentase pelunasannya cuma dari kontrak yang
              aktif di 3 bulan terakhir untuk produk itu — rentang waktu yang jauh lebih pendek daripada versi
              Label Customer.</p>
          </>
        ),
      },
      {
        name: "Running Rate (kartu kontrak)",
        keywords: "running rate kontrak pssp aktif target pace",
        body: (
          <>
            <p>Bandingin progres pelunasan aktual kontrak dengan seberapa jauh periode kontraknya sendiri sudah
              berjalan (bukan dari 0–100% polos) — cuma muncul untuk kontrak yang masih aktif.</p>
            <Formula>{"Running Rate = Pelunasan% ÷ (bulan berjalan ÷ total bulan kontrak × 100%) × 100%"}</Formula>
            <p>≥100% <span style={{ color: "var(--color-success, #16a34a)" }}>(hijau)</span> = sesuai/lebih cepat
              dari target waktu. 70–99% <span style={{ color: "var(--color-warning)" }}>(kuning)</span> = agak
              lambat. &lt;70% <span style={{ color: "var(--color-red)" }}>(merah)</span> = tertinggal jauh — sama
              persis konsepnya dengan &ldquo;Pelunasan Running Rate&rdquo; di Summary tab Outlet, cuma dihitung per
              kontrak tunggal di sini, bukan agregat satu outlet.</p>
          </>
        ),
      },
    ],
  },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD");
}

function termMatches(term: TermDef, query: string): boolean {
  if (!query) return true;
  const haystack = normalize(`${term.name} ${term.tag ?? ""} ${term.keywords ?? ""}`);
  return haystack.includes(query);
}

// Sorting has no per-term list (its content is a ladder, not a glossary row) — matched
// against these section-level keywords instead so it doesn't just vanish while searching.
const SECTION_KEYWORDS: Record<string, string> = {
  sorting: "sorting urutan gap tertinggi estimasi tertinggi pssp aktif realisasi sebelumnya",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function FaqContent() {
  const [query, setQuery] = useState("");

  const filteredSections = useMemo(() => {
    const q = normalize(query.trim());
    return SECTIONS
      .map((s) => ({ ...s, terms: s.terms.filter((t) => termMatches(t, q)) }))
      .filter((s) => s.terms.length > 0 || (!!s.extra && (!q || normalize(SECTION_KEYWORDS[s.id] ?? "").includes(q))));
  }, [query]);

  const totalCount = SECTIONS.reduce((s, sec) => s + sec.terms.length, 0);
  const shownCount = filteredSections.reduce((s, sec) => s + sec.terms.length, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1>FAQ</h1>
        <p className="mt-1 text-sm max-w-[68ch]" style={{ color: "var(--color-text-muted)" }}>
          Referensi istilah &amp; cara hitung yang GAK umum di halaman <Link href="/summary">Summary</Link> dan form
          Rencana PSSP per dokter — istilah yang sudah jelas dari nama kolomnya sendiri sengaja tidak dimasukkan.
        </p>
      </div>

      <div className="sticky top-0 z-10" style={{ background: "var(--color-bg)" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari istilah… (mis. gap, retensi, growth pelunasan, running rate)"
          className="input-field w-full"
          aria-label="Cari istilah"
        />
      </div>

      {query.trim() && (
        <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
          {filteredSections.length > 0 ? `${shownCount} dari ${totalCount} istilah cocok.` : "Tidak ada istilah yang cocok."}
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
            <PartTitle>{section.title}</PartTitle>
            {section.note && <SectionNote>{section.note}</SectionNote>}
            <div>
              {section.terms.map((term) => (
                <Def key={term.name} name={term.name} tag={term.tag}>{term.body}</Def>
              ))}
            </div>
            {section.extra}
          </Card>
        ))
      )}

      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Dibuat dari pembacaan langsung <InlineCode>summary/page.tsx</InlineCode>, <InlineCode>MonitoringChecklist.tsx</InlineCode>,
        <InlineCode>TerritoryTable.tsx</InlineCode>, dan <InlineCode>LineItemEditor.tsx</InlineCode>. Kalau rumusnya
        berubah di kode, halaman ini perlu diperbarui juga.
      </p>
    </div>
  );
}
