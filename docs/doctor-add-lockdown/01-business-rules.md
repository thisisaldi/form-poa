# Matikan Fitur Tambah Dokter Baru — Business Rules

Requirement asli: lihat `README.md` §Sumber requirement.

## 1. Dua surface "tambah dokter" — jangan tertukar

| Surface | Status saat ini | Disentuh spec ini? |
|---|---|---|
| Halaman `/customers/new` (`src/app/(app)/customers/new/page.tsx:18`) | Sudah placeholder mati: "Fitur Daftar Dokter Baru masih dalam pengembangan dan belum dapat digunakan." Tidak ada di Sidebar. Tombol dashboard `+ Daftar User Baru` (`dashboard/page.tsx:325`) juga sudah jadi `NotReadyButton` (toast, tidak navigasi) — sudah didokumentasikan sebagai "Selesai" secara internal (`docs/TODO.md` §"Item tambahan" — "Tombol '+ Daftar User Baru' menjadi toast 'belum ready'"). | **Tidak** — sudah mati, tidak perlu kerjaan tambahan. |
| `AddDokterBaruPanel` di dalam `src/components/poa/LineItemEditor.tsx:3207+` | **Hidup dan aktif dipakai** — dipicu dari tombol "+ [nama tidak ditemukan, daftarkan baru]" di `AddPanel` (`LineItemEditor.tsx:2837-2841`, prop `onAddNewCustomer`) saat MR mencari dokter di suatu outlet dan tidak ketemu, baik di DB lokal maupun live-search Nexus. Submit lewat `createCustomerAction()` (`src/app/actions/customer.ts:18-60+`). | **Ya — ini yang dimatikan.** |

## 2. Istilah "Exodus" (bisnis) = API Nexus (teknis) — dikonfirmasi, BUKAN kesalahan penyebutan

Task menyebut "conflict/crash database dengan Exodus". Klarifikasi dengan pengguna (2026-08-10): **"Exodus" adalah nama sistem/penyebutan internal tim untuk sistem yang sama** dengan API yang di kode dan `docs/form-poa/03-ui-and-access.md:149` disebut **Nexus** (`api-nexus.pharos.id`) — bukan dua sistem berbeda, cuma dua nama untuk hal yang sama, dipakai di konteks berbeda (tim bisnis/downstream menyebutnya "Exodus", kode/dokumentasi teknis menyebutnya "Nexus").

**Penting — jangan tertukar dengan `src/lib/exodusApi.ts`**: nama file itu kebetulan mirip ("Exodus Activity API"), tapi itu adalah sistem BERBEDA — cuma menyediakan data riwayat kunjungan (visit count per customer+outlet+periode), OAuth2 client-credentials, selalu degradasi ke `null` kalau gagal/tidak dikonfigurasi (`docs/form-poa/03-ui-and-access.md` §6), dan **tidak terlibat** dalam pembuatan/dedup data dokter. Jangan sampai kemiripan nama file ini bikin implementer salah sasaran menyentuh `exodusApi.ts` saat mengerjakan spec ini.

**Endpoint konkret yang relevan** (dikonfirmasi pengguna via contoh dokumentasi API "Get Customer By Outlet"):
```
GET https://api-nexus.pharos.id/api/r/poa/get_customer_by_outlet?outlet_code={kodePI}
```
Sudah diimplementasikan dan LIVE — `fetchNexusCustomersByOutlet()` (`src/app/actions/customer.ts:530-548`), dipanggil dari `getCustomersByOutlet()` (`:573-590`), dijalankan paralel dengan query `CustomerOutlet` lokal, hasilnya digabung jadi satu daftar dropdown "Tambah Rencana POA" di `AddPanel` (`LineItemEditor.tsx`). Kalau dokter ditemukan cuma di hasil ini (belum ada di DB lokal), hasilnya punya synthetic id `nexus:<kode>` yang, begitu dipakai, dimaterialisasi jadi row `Customer` asli lewat `createCustomerAction` (`customer.ts:41-49`, fix 2026-07-29 untuk kasus dedup nama/spesialisasi sedikit beda).

**Inilah sistem yang genuinely berisiko conflict/dedup dengan penambahan dokter manual** — kalau MR menambah dokter manual dengan nama/kode yang nanti ternyata sudah ada/match di sistem "Exodus"/Nexus ini, berpotensi duplikat atau konflik saat data POA dimasukkan ke sistem tersebut downstream — inilah alasan bisnis di balik requirement task #2 (matikan input manual, supaya semua dokter baru genuinely berasal dari sinkronisasi sistem Exodus/Nexus, bukan input manual yang berisiko tidak sinkron).

## 3. Requirement konkret (v1)

1. `AddDokterBaruPanel` (`LineItemEditor.tsx:3207+`) tidak lagi bisa diakses oleh role manapun. Tombol pemicunya (`onAddNewCustomer`, `LineItemEditor.tsx:2837-2841`, teks "kodePI && !loadingCust && onAddNewCustomer && ..." — tepatnya link "Belum ketemu? Daftarkan dokter baru" atau serupa) tidak lagi dirender.
2. Server action `createCustomerAction()` (`src/app/actions/customer.ts:18-60+`) tidak lagi dipanggil dari jalur UI **penambahan dokter baru manual** — TIDAK perlu dihapus dari kode (lihat `03-ui-and-access.md` §non-goals soal opsi hapus vs disable), tapi harus jadi dead code untuk jalur itu. **Catatan**: fungsi ini tetap dipakai untuk jalur LAIN — materialisasi `Customer` dari hasil API saat dipilih (lihat §5) — jadi tidak sepenuhnya unreachable, cuma trigger manualnya yang mati.
3. Kalau MR mencari dokter di suatu outlet dan tidak ketemu (di DB lokal maupun live-search API), UI menampilkan pesan informatif (bukan silently menghilangkan opsi tanpa penjelasan) — mis. "Dokter tidak ditemukan. Hubungi Admin/tim data untuk pendaftaran dokter baru." Pesan pasti perlu dikonfirmasi/disesuaikan saat implementasi, tapi prinsipnya: MR tidak boleh mentok tanpa tahu harus berbuat apa.
4. Sumber dokter yang bisa dipakai MR jadi murni: (a) data `Customer` yang sudah ada di DB lokal, (b) hasil live-search API Exodus/Nexus yang match record yang SUDAH tersinkron (bukan dokter yang genuinely belum pernah ada di manapun).

## 5. Pencarian dokter per outlet — DITOLAK, tetap gabungan DB + API (keputusan final 2026-08-10)

**Requirement tambahan yang sempat dipertimbangkan** (diajukan pengguna 2026-08-10): mengubah pencarian dokter per outlet jadi 100% API, drop merge dengan `CustomerOutlet` lokal. **Divalidasi dulu sebelum implementasi** (lihat §6, hasil `scripts/checkCustomerFullApiGap.ts`) — dampaknya ternyata signifikan: 15,7% customer lokal (3.338 dari 21.275) tidak match hasil API dan akan hilang dari pencarian, 34% outlet kena.

**Keputusan final pengguna setelah melihat data**: **TIDAK jadi diimplementasikan** — `getCustomersByOutlet()` (`customer.ts:573-590`) **tetap seperti sekarang**, tetap menggabungkan hasil query `CustomerOutlet` lokal DENGAN live-search API (`fetchNexusCustomersByOutlet`), tidak ada perubahan kode untuk fungsi ini. Satu-satunya perubahan yang jadi diimplementasikan dari spec ini adalah §3 (matikan tombol tambah dokter manual) — bagian pencarian tidak disentuh sama sekali.

Bagian ini (dan hasil validasi di §6) dipertahankan di dokumen sebagai catatan histori keputusan — supaya kalau ide "full-API search" muncul lagi di masa depan, sudah ada data konkret (bukan mulai dari nol) untuk dipertimbangkan ulang.

## 6. Validasi "full-API search" yang dilakukan sebelum keputusan §5 (dipertahankan sebagai histori)

- **Dokter benar-benar baru yang belum ada di API Exodus/Nexus maupun DB lokal** — MR tetap **tidak punya jalan** untuk memasukkan dokter itu ke POA setelah §3 diimplementasikan (ini tidak berubah oleh keputusan §5, murni konsekuensi dari mematikan tombol tambah manual). Trade-off yang disengaja — ada proses manual di luar aplikasi (mis. request ke admin/tim data) yang perlu ada supaya dokter baru genuinely bisa masuk sistem — **di luar scope teknis spec ini**.
- **Validasi dampak "full-API search" (2026-08-10)** — dijalankan `scripts/checkCustomerFullApiGap.ts` (read-only, sama pola diagnostic dengan `scripts/compareNexusVsStrukturBaru.ts` yang sudah ada) untuk cek: kalau pencarian jadi 100% API (tanpa merge DB), berapa banyak customer lokal yang hilang dari pencarian? Hasil terhadap **2.750 outlet** yang punya data customer lokal:

  | Metrik | Angka |
  |---|---|
  | Total customer lokal yang dicek | 21.275 |
  | Customer lokal yang TIDAK match hasil API (akan hilang dari pencarian KALAU full-API jadi diimplementasikan) | 3.338 (15,7%) |
  | Outlet dengan minimal 1 customer hilang | 942 dari 2.742 outlet yang berhasil dicek (34%) |
  | Outlet terparah | `G1000323` (63% hilang), `F1000290` (87% hilang), `G1003588` (77% hilang) |

  **Hasil validasi inilah yang jadi dasar keputusan §5**: dampaknya cukup besar (bukan edge case langka) sehingga pengguna memutuskan **tetap pakai gabungan DB + API** untuk pencarian, bukan full-API. Tidak ada perubahan kode akibat temuan ini — DB tetap jadi bagian dari pencarian seperti sekarang.
- **Race condition** — kalau ada draft POA yang statenya mid-flow memakai `mode === "addBaru"` (misal user sudah buka form tapi belum submit saat deploy terjadi) — tidak ada state persist di server untuk mode UI ini (`useState` lokal komponen), jadi tidak ada risiko data korup, submit form akan gagal wajar (komponen sudah tidak dirender) begitu halaman di-refresh.

## Open questions — status & assumptions dipakai untuk v1

**Tidak ada open question BLOCKING** — §3 (matikan tombol tambah manual, satu-satunya perubahan yang jadi diimplementasikan) sudah jelas dan dikonfirmasi pengguna (matikan total, semua role). §5 (full-API search) sudah final DITOLAK setelah validasi data — tidak ada kerjaan lanjutan untuk bagian itu.

| # | Pertanyaan | Asumsi yang dipakai untuk v1 | Perlu konfirmasi dari |
|---|---|---|---|
| OQ-1 (non-blocking) | Teks pesan pengganti saat dokter tidak ditemukan (§3.3) — perlu kata-kata pasti (mis. kontak siapa). | Placeholder generik di atas, disempurnakan saat implementasi. | Pengguna, opsional |
| OQ-2 (non-blocking) | Apakah nanti perlu dibangun alur "request dokter baru ke admin" sebagai pengganti (workflow terpisah, out of scope v1 ini) — lihat `03-ui-and-access.md` §Non-goals. | Tidak dibangun di v1 — murni dimatikan tanpa pengganti. | Pengguna, kalau muncul kebutuhan operasional nyata |
