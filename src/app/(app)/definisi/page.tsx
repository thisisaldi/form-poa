import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Definisi · Form POA" };

// ─── Content primitives ───────────────────────────────────────────────────────

function PartTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-[0.14em] pb-3 mb-5"
      style={{ color: "var(--color-blue)", borderBottom: "1px solid var(--color-border)" }}>
      {children}
    </h2>
  );
}

function SectionTitle({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-4 text-base font-semibold mt-8 mb-1" style={{ color: "var(--color-text)" }}>
      {children}
    </h3>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm max-w-[68ch] mb-3" style={{ color: "var(--color-text-muted)" }}>
      {children}
    </p>
  );
}

function SubHeading({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" }) {
  return (
    <h4 className="text-sm font-semibold mt-6 mb-2 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
      {children}
      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
        style={{
          background: tone === "green" ? "var(--color-green-light)" : "var(--color-blue-light)",
          color: tone === "green" ? "var(--color-green)" : "var(--color-blue)",
        }}>
        Default
      </span>
    </h4>
  );
}

function Def({ name, only, children }: { name: string; only?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-5 gap-y-1 py-3"
      style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        {name}
        {only && (
          <span className="block sm:inline sm:ml-2 mt-1 sm:mt-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: "var(--color-text-faint)", border: "1px solid var(--color-border-strong)" }}>
            {only}
          </span>
        )}
      </div>
      <div className="text-sm space-y-1.5" style={{ color: "var(--color-text-muted)" }}>{children}</div>
    </div>
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
    <div className="flex gap-2 text-sm px-3 py-2.5 rounded-md my-3"
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const TOC = [
  { href: "#ringkasan", label: "Ringkasan (kartu atas)" },
  { href: "#outlet", label: "Tab Per Outlet" },
  { href: "#customer", label: "Tab Per Customer" },
  { href: "#produk", label: "Tab Per Produk" },
  { href: "#personil", label: "Tab Per Personil" },
  { href: "#sorting", label: "Urutan (Sorting)" },
];

export default async function DefinisiPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.role === "MR") redirect("/dashboard");

  return (
    <div className="space-y-5">
      <div>
        <h1>Definisi</h1>
        <p className="mt-1 text-sm max-w-[68ch]" style={{ color: "var(--color-text-muted)" }}>
          Referensi definisi dan cara hitung istilah-istilah di Form POA — untuk tiap istilah: artinya apa, dan cara
          hitungnya persis seperti di kode. Bagian pertama mencakup halaman <Link href="/summary">Summary</Link>;
          bagian lain akan ditambahkan menyusul.
        </p>
      </div>

      {/* Quick jump */}
      <Card>
        <div className="flex flex-wrap gap-1.5">
          {TOC.map((t) => (
            <a key={t.href} href={t.href}
              className="text-xs font-medium px-2.5 py-1 rounded-md"
              style={{ background: "var(--color-bg-subtle)", color: "var(--color-text-muted)" }}>
              {t.label}
            </a>
          ))}
        </div>
      </Card>

      <Card>
        <PartTitle>Summary</PartTitle>

        {/* ═══ RINGKASAN ═══ */}
        <SectionTitle id="ringkasan">Ringkasan (kartu atas)</SectionTitle>
        <SectionNote>
          Selalu agregat dari seluruh baris yang lagi ditampilkan di tab yang aktif (sudah kefilter periode kalau ada
          filter periode dipilih) — bukan cuma satu outlet/customer, tapi total semuanya.
        </SectionNote>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>Estimasi</h4>
        <div>
          <Def name="Estimasi POA / Estimasi Aktif+Pengajuan">
            <p>Kalau ada kontrak PSSP yang masih aktif di outlet-outlet yang tercakup, judul &amp; angkanya menggabungkan
              estimasi aktif dengan estimasi pengajuan, plus rincian &ldquo;Aktif ... · Pengajuan ...&rdquo; di bawahnya.</p>
            <Formula>Σ rencanaTotalBiaya (pengajuan) + Σ estBaris (kontrak PSSP aktif)</Formula>
          </Def>
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>Variasi Produk</h4>
        <div>
          <Def name="Produk Fokus">
            <p>Jumlah kode produk unik yang termasuk paket fokus PM, dari target 22 variasi. Merah kalau belum tercapai.</p>
            <Formula>unique(kodeProduk) WHERE getAllPakets(namaProduk).length &gt; 0</Formula>
          </Def>
          <Def name="Produk PSSP">
            <p>Jumlah kode produk unik yang punya persentase PSSP dokter &gt; 0 di baris manapun.</p>
            <Formula>unique(kodeProduk) WHERE persenPsspDokter &gt; 0</Formula>
          </Def>
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>Anggaran</h4>
        <div>
          <Def name="PSSP">
            <p>Total nilai PSSP dari seluruh baris — pakai <InlineCode>pengaliNilaiR</InlineCode> per-produk kalau ada override, default 1.</p>
            <Formula>Σ rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR</Formula>
          </Def>
          <Def name="Discount + DPL + DPF">
            <p>Gabungan tiga persentase potongan per baris, dijumlah jadi satu.</p>
            <Formula>Σ rencanaTotalBiaya × (persenDiskon + persenDp + persenListingFee)</Formula>
          </Def>
          <Def name="Entertain">
            <Formula>Σ rencanaTotalBiaya × persenEntertain</Formula>
          </Def>
          <Def name="Total Budget">
            <p>Jumlah tiga baris di atas. Persentase di sampingnya = Total Budget ÷ Estimasi POA.</p>
            <Formula>PSSP + Discount/DPL/DPF + Entertain</Formula>
          </Def>
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>Cakupan</h4>
        <div>
          <Def name="Customer per MR"><p>Jumlah nama customer unik. Target minimal 30 — kurang dari itu ditandai merah.</p></Def>
          <Def name="Produk PSSP / MR"><p>Sama seperti &ldquo;Produk PSSP&rdquo; di atas, ditampilkan ulang sebagai ringkasan cakupan.</p></Def>
          <Def name="Total Pengajuan"><p>Jumlah baris pengajuan (satu baris = satu kombinasi produk × customer).</p></Def>
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>Listing Produk</h4>
        <div>
          <Def name="Sudah listing"><p>Kode produk unik dengan status Listing Corporate = <InlineCode>SUDAH_STANDARISASI</InlineCode>.</p></Def>
          <Def name="Proses"><p>Kode produk unik berstatus <InlineCode>PROSES_PENGAJUAN</InlineCode>, dikurangi yang sudah terhitung di &ldquo;Sudah listing&rdquo; (satu produk tidak dobel-hitung).</p></Def>
          <Def name="Belum">
            <p>Sisanya — total variasi produk unik dikurangi yang sudah listing. Muncul kalau &gt; 0, ditandai merah.</p>
            <Formula>totalUniqueProducts − Sudah listing</Formula>
          </Def>
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-1" style={{ color: "var(--color-text)" }}>
          Data Sales <span className="text-[10px] font-semibold ml-1 px-1.5 py-0.5 rounded" style={{ color: "var(--color-text-faint)", border: "1px solid var(--color-border-strong)" }}>Hanya tab Outlet &amp; Personil</span>
        </h4>
        <Note>
          <p>Sumbernya DIR10001B (<InlineCode>OutletSalesValueMonthly</InlineCode>), yang cuma level outlet — tidak ada
            breakdown per Customer atau per Produk, jadi kartu ini disembunyikan di dua tab itu.</p>
        </Note>
        <div>
          <Def name="Historis Tahun Lalu"><p>Total nilai sales Januari–Desember tahun lalu, penuh 12 bulan.</p></Def>
          <Def name="Sales YTD"><p>Total nilai sales tahun berjalan, dari Januari sampai bulan terakhir yang datanya sudah lengkap.</p></Def>
          <Def name="Sales YTD + Estimasi"><Formula>Sales YTD + Estimasi POA</Formula></Def>
          <Def name="Growth YTD">
            <p>Growth-of-totals (bukan rata-rata persentase per grup) — jumlah Sales YTD semua grup dibanding jumlah
              periode pembanding tahun lalu semua grup, supaya tidak melenceng dari angka Rupiah yang sama-sama
              ditampilkan di kartu ini.</p>
            <Formula>(ΣSales YTD − ΣSales YTD tahun lalu) ÷ ΣSales YTD tahun lalu × 100%</Formula>
          </Def>
          <Def name="Achievement YTD+Est">
            <p>Sales YTD + Estimasi, dibanding target yang diprorata dari pace tahun lalu — dijumlah dulu antar grup,
              baru dibagi, dengan alasan yang sama seperti Growth YTD.</p>
            <Formula>Σ(Sales YTD+Est) ÷ Σ(Historis Tahun Lalu ÷ 12 × bulan berjalan) × 100%</Formula>
          </Def>
        </div>

        {/* ═══ OUTLET ═══ */}
        <SectionTitle id="outlet">Tab Per Outlet</SectionTitle>
        <SectionNote>
          Tab paling lengkap kolomnya — gabungan data pengajuan (draft/POA) dengan data PSSP &amp; sales yang real/aktif
          di sistem, bukan cuma yang diajukan.
        </SectionNote>
        <div>
          <Def name="Estimasi Aktif+Pengajuan">
            <p>Nilai kontrak PSSP yang masih berjalan sekarang di outlet ini, ditambah estimasi dari pengajuan POA.
              Rincian &ldquo;Aktif ... · Pengajuan ...&rdquo; muncul di bawah angka totalnya.</p>
            <Formula>estimasiAktif (Σ estBaris kontrak PSSP AKTIF) + Estimasi (Σ rencanaTotalBiaya pengajuan)</Formula>
          </Def>
          <Def name="Realisasi Sebelumnya">
            <p>Total yang pernah benar-benar lunas dibayar di outlet ini — dari semua kontrak PSSP, baik yang sudah
              kelar maupun yang masih jalan. Beda dengan &ldquo;Estimasi Aktif&rdquo; (itu nilai kontrak, ini duit yang
              sudah masuk).</p>
            <Formula>Σ totalLunas — semua PsspKontrak milik outlet ini</Formula>
          </Def>
          <Def name="Gap">
            <p>Estimasi sekarang dikurangi Realisasi Sebelumnya. Merah kalau positif — sinyal &ldquo;dulu realisasinya
              segini, kok sekarang estimasinya jauh lebih tinggi&rdquo;, perlu dicek kewajarannya.</p>
            <Formula>Estimasi − Realisasi Sebelumnya</Formula>
          </Def>
          <Def name="User PSSP (Aktif+Estimasi)">
            <p>Jumlah customer unik yang punya kontrak PSSP aktif ATAU sudah ada di pengajuan draft — digabung jadi
              satu (union), jadi customer yang ada di keduanya cuma dihitung sekali.</p>
          </Def>
          <Def name="Variasi Produk (Fokus/Non-Fokus)"><p>Dua angka: jumlah kode produk unik yang fokus PM, garis miring, jumlah yang bukan fokus.</p></Def>
          <Def name="Pengajuan"><p>Jumlah baris pengajuan di outlet ini.</p></Def>
          <Def name="Budget"><p>Sama seperti Total Budget di kartu Ringkasan (PSSP+Discount+Entertain), khusus outlet ini.</p></Def>
          <Def name="Cost Ratio"><Formula>Budget ÷ Estimasi (pengajuan saja) × 100%</Formula></Def>
          <Def name="Sales Aktif (2026)"><p>Nilai sales riil (DIR10001B) di outlet ini sejak Januari 2026 — angka Rupiah beneran, bukan turunan dari estimasi.</p></Def>
          <Def name="Estimasi Per User"><Formula>Estimasi Aktif+Pengajuan ÷ User PSSP (Aktif+Estimasi)</Formula></Def>
          <Def name="Listing Fee"><p>Total nilai kontrak Listing Fee di outlet ini. Satu kontrak dengan banyak produk cuma dihitung sekali nilainya (tidak dikali jumlah produk).</p></Def>
          <Def name="Pelunasan (%) Running Rate">
            <p>Apakah pelunasan kontrak PSSP aktif di outlet ini sesuai target di titik waktu sekarang — bukan progres
              dari 0–100%, tapi progres relatif ke seberapa jauh periode kontraknya sudah berjalan.</p>
            <Formula>Σ totalLunas AKTUAL ÷ Σ (estBaris × fraksi waktu kontrak berjalan) × 100%</Formula>
            <p>≥100% <span style={{ color: "var(--color-success, #16a34a)" }}>(hijau)</span> = sesuai/lebih cepat dari
              target waktu. 70–99% <span style={{ color: "var(--color-warning)" }}>(kuning)</span> = agak lambat.
              &lt;70% <span style={{ color: "var(--color-red)" }}>(merah)</span> = tertinggal jauh.</p>
          </Def>
        </div>

        {/* ═══ CUSTOMER ═══ */}
        <SectionTitle id="customer">Tab Per Customer</SectionTitle>
        <SectionNote>Lebih ringkas dari tab Outlet — versi per-dokter dari kolom dasar, plus Realisasi Sebelumnya &amp; Gap.</SectionNote>
        <div>
          <Def name="Estimasi"><p>Total rencana biaya pengajuan untuk customer ini saja (tidak digabung dengan nilai kontrak aktif seperti tab Outlet).</p></Def>
          <Def name="Realisasi Sebelumnya"><Formula>Σ totalLunas — semua PsspKontrak milik customer ini</Formula></Def>
          <Def name="Gap"><Formula>Estimasi − Realisasi Sebelumnya</Formula></Def>
          <Def name="Customer"><p>Selalu 1 — setiap baris tabel ini memang satu customer.</p></Def>
          <Def name="Produk Fokus"><p>Jumlah kode produk fokus unik yang diajukan untuk customer ini.</p></Def>
          <Def name="Pengajuan"><p>Jumlah baris pengajuan customer ini (biasanya = jumlah produk yang diajukan ke dia).</p></Def>
          <Def name="% Budget"><Formula>Budget ÷ Estimasi × 100%</Formula></Def>
          <Def name="Listing">
            <p>Perbandingan produk yang sudah listing terhadap total variasi produk customer ini — bukan angka global, spesifik ke baris ini saja.</p>
            <Formula>terstandarisasi / (terstandarisasi + proses + belum)</Formula>
          </Def>
        </div>

        {/* ═══ PRODUK ═══ */}
        <SectionTitle id="produk">Tab Per Produk</SectionTitle>
        <SectionNote>
          Sudut pandang per-produk — kolom pertamanya &ldquo;Status&rdquo; (Fokus/Non-Fokus), bukan PIC. Tidak ada
          Realisasi Sebelumnya di tab ini (belum ada mapping realisasi ke level produk).
        </SectionNote>
        <div>
          <Def name="Status"><p><span style={{ color: "var(--color-blue)" }}>Fokus</span> kalau produk ini termasuk paket fokus PM, <span style={{ color: "var(--color-text-muted)" }}>Non-Fokus</span> kalau bukan.</p></Def>
          <Def name="Estimasi Aktif+Pengajuan"><p>Sama konsepnya dengan tab Outlet, tapi kontrak PSSP aktifnya dicocokkan lewat nama produk (bukan kode) — sistem PSSP pakai kode produk yang beda namespace-nya dari kode produk internal.</p></Def>
          <Def name="User Aktif PSSP"><p>Jumlah customer unik dengan kontrak PSSP aktif untuk produk ini.</p></Def>
          <Def name="Pengajuan"><p>Jumlah baris pengajuan untuk produk ini di seluruh customer.</p></Def>
          <Def name="Budget &amp; Cost Ratio"><p>Rumus sama dengan tab Outlet, dihitung khusus produk ini.</p></Def>
          <Def name="Sales Aktif (2026)">
            <p><strong style={{ color: "var(--color-text)" }}>Beda sumber</strong> dari tab Outlet — bukan angka Rupiah riil, tapi qty terjual (dari data kuantitas sales, sejak Jan 2026) dikali HNA produk. Nilai estimasi/turunan, bukan Rupiah yang benar-benar tercatat.</p>
            <Formula>qty terjual × HNA</Formula>
          </Def>
          <Def name="Estimasi Per User"><p>Nama kolomnya sama seperti tab Outlet, isinya &ldquo;Sales Per User&rdquo;.</p></Def>
          <Def name="Sales Per User"><Formula>Sales Aktif ÷ User Aktif PSSP</Formula></Def>
          <Def name="AVG Pasien/User"><p>Rata-rata jumlah pasien/hari, dari baris-baris pengajuan produk ini yang field-nya sudah diisi.</p></Def>
          <Def name="AVG ST/Pasien">
            <p>Rata-rata satuan terkecil per pasien.</p>
            <Formula>rata-rata dari (qtyProdukResep ÷ jumlahPasienHari)</Formula>
          </Def>
        </div>

        {/* ═══ PERSONIL ═══ */}
        <SectionTitle id="personil">Tab Per Personil</SectionTitle>
        <SectionNote>
          Paling sederhana — struktur kolomnya sama dengan Per Customer, tapi baris = 1 MR, bukan 1 dokter. Tidak ada
          Realisasi Sebelumnya (belum ada agregasi realisasi per-MR).
        </SectionNote>
        <div>
          <Def name="PIC"><p>Nama MR itu sendiri.</p></Def>
          <Def name="Estimasi, Customer, Produk Fokus, Pengajuan, % Budget, Listing">
            <p>Rumus persis sama seperti versi Per Customer di atas, dihitung dari semua baris pengajuan milik MR ini (gabungan semua customer-nya).</p>
          </Def>
        </div>

        {/* ═══ SORTING ═══ */}
        <SectionTitle id="sorting">Urutan (Sorting)</SectionTitle>
        <SectionNote>
          Toggle &ldquo;Urutkan: GAP Tertinggi / Estimasi Tertinggi&rdquo; cuma muncul di tab Outlet &amp; Customer — dua
          tab lain selalu urut Estimasi tertinggi, tidak bisa diganti.
        </SectionNote>

        <SubHeading>GAP Tertinggi — tab Outlet</SubHeading>
        <Ladder steps={[
          <>Outlet dengan <strong style={{ color: "var(--color-text)" }}>PSSP Aktif</strong> (estimasiAktif &gt; 0) selalu di atas outlet yang tidak punya.</>,
          <>Di antara sesama yang PSSP Aktif: urut <strong style={{ color: "var(--color-text)" }}>Gap tertinggi</strong> ke rendah.</>,
          <>Sisanya (tidak ada PSSP Aktif): urut <strong style={{ color: "var(--color-text)" }}>Estimasi tertinggi</strong> ke rendah.</>,
        ]} />

        <SubHeading tone="green">GAP Tertinggi — tab Customer</SubHeading>
        <Ladder steps={[
          <>Customer dengan <strong style={{ color: "var(--color-text)" }}>Realisasi Sebelumnya &gt; 0</strong> selalu di atas yang belum pernah ada realisasi.</>,
          <>Di antara yang ada realisasi: urut <strong style={{ color: "var(--color-text)" }}>Gap tertinggi</strong> ke rendah.</>,
          <>Sisanya: urut <strong style={{ color: "var(--color-text)" }}>Estimasi tertinggi</strong> ke rendah.</>,
        ]} />

        <Note>
          <p>Outlet pakai kriteria &ldquo;PSSP Aktif&rdquo; (kontrak yang masih berjalan), Customer pakai &ldquo;Realisasi
            Sebelumnya&rdquo; (duit yang pernah lunas, aktif atau sudah selesai) — dua kriteria beda karena tab Outlet
            punya data kontrak aktif yang tab Customer tidak punya.</p>
        </Note>

        <h4 className="text-sm font-semibold mt-6 mb-1" style={{ color: "var(--color-text)" }}>Estimasi Tertinggi</h4>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Sort polos — semua baris diurutkan dari Estimasi terbesar ke terkecil, tanpa mempedulikan Realisasi/PSSP
          Aktif sama sekali.
        </p>
      </Card>

      <p className="text-xs" style={{ color: "var(--color-text-faint)" }}>
        Dibuat dari pembacaan langsung <InlineCode>summary/page.tsx</InlineCode>, <InlineCode>MonitoringChecklist.tsx</InlineCode>,
        dan <InlineCode>TerritoryTable.tsx</InlineCode>. Kalau rumusnya berubah di kode, halaman ini perlu diperbarui juga.
      </p>
    </div>
  );
}
