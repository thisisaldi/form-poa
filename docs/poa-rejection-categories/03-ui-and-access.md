# Kategori Rejection POA — UI & Access

## 1. Lokasi

`src/app/(app)/poa/[id]/page.tsx` — form "Tolak (kembali ke Revisi)" (`:411-425`), reuse pola form existing (textarea + tombol submit di dalam `<details>`/collapsible section, sesuai pola form Tolak/Batalkan yang sudah ada di halaman ini).

Kalau OQ-1 (`01-business-rules.md`) dijawab "berlaku ke ketiga form", tambahkan juga ke:
- Form "Tolak Permintaan Edit" (`:349-361`)
- Form "Batalkan Approval" (`:442-449`)

## 2. Perubahan form

Tambah `<select name="rejectCategory" required>` di atas textarea `reason` yang sudah ada:

```
Kategori Rejection *
[ -- pilih kategori -- ]
  Produk
  Outlet
  User
  Periode
  Kalkulasi PSSP
  Alasan Lain

Alasan Reject *
[ textarea, existing, tidak berubah ]
```

Reuse styling input `<select>` yang sudah dipakai di form lain di app ini (mis. dropdown kuartal di `RingkasanQuarterFilter`, atau dropdown role di admin) — bukan komponen baru.

## 3. Tampilan di Riwayat Aktivitas

`page.tsx:495-499` saat ini merender `snapshot.notes` sebagai teks italic dikutip. Tambahkan badge/label kategori di sebelah teks itu, mis.:

```
[Produk] "Produk yang dipilih tidak sesuai kriteria Kontes untuk outlet ini"
— ditolak oleh ASM [nama], 2026-08-10 14:32
```

Untuk entry lama (sebelum fitur ini ada, `rejectCategory = null`) — tampilkan tanpa badge kategori (bukan "Tidak ada kategori" atau placeholder kosong, cukup tidak render badge-nya sama sekali), supaya histori lama tidak terlihat rusak/error.

## 4. Role & akses

Tidak ada perubahan role/akses — reuse gate `canApprove()` yang sudah menentukan siapa yang bisa melihat/memakai form Tolak (ASM/SM/NSM sesuai level POA saat ini, `docs/form-poa/03-ui-and-access.md`). Kategori adalah field tambahan di form yang aksesnya sudah digate, bukan permission baru.

## 5. Non-goals v1

- **Tidak membangun laporan/dashboard agregat "reject per kategori"** — spec ini hanya menyimpan kategorinya (lihat `02-data-model.md` OQ-5 untuk kemungkinan v2). Laporan adalah scope terpisah kalau diminta eksplisit.
- **Tidak mengubah 2 form lain** (Tolak Permintaan Edit, Batalkan Approval) kecuali OQ-1 dijawab mencakup keduanya.
- **Tidak menambah notifikasi baru** (email/in-app) berbasis kategori — notifikasi reject yang sudah ada (`sendPoaStatusEmail`, `poaWorkflow.ts:165-167`) tidak disentuh, tetap fire-and-forget seperti sekarang.
- **Tidak mengubah export Excel** — kategori rejection tidak ditambahkan ke sheet export manapun di v1 (kandidat v2 kalau diminta).
