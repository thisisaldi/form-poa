# POA Standarisasi Pusat (Hospital Key Account) — Spec Index

*(Ditulis 2026-10-06, mengikuti SDD `docs/sdd/`. Sumber requirement: percakapan dengan pengguna [m.naufaldi.aldi@gmail.com] 2026-10-06 + dua file internal: `internal/Grouping Hospital Key Account (1).xlsx` (255 outlet → 11 grup) dan `internal/TARGET Hospital Key Account Q3.xlsx` (sheet "PIC Hospital Key Account", PIC per outlet). Bukan memo resmi.)*

Trigger SDD terpenuhi: kapabilitas/role baru (HKA), model data baru, gateway yang mengubah flow standarisasi cabang yang sudah jalan, dan ambiguitas nyata (§7 di `01-business-rules.md`).

## Dokumen
1. [`01-business-rules.md`](./01-business-rules.md) — definisi, gateway, approval, open questions.
2. [`02-data-model.md`](./02-data-model.md) — kolom/model baru, import grup.
3. [`03-ui-and-access.md`](./03-ui-and-access.md) — akses, halaman, non-goals.

## Status
🟢 **v1 diimplementasikan 2026-10-06** (migration `20261006200000_add_poa_standarisasi_pusat` belum dijalankan di DB manapun; `prisma generate` perlu diulang setelah dev server dihentikan). Tidak diimplementasikan di v1: upload surat approval Finalisasi, log/alasan ganti dokter (ganti = hapus + tambah), edit Planning setelah pengajuan dibuat (create langsung masuk Approval, sama seperti cabang), BUMN (menunggu Q2). Cek logika approval: `npx tsx scripts/checkHka.ts`; uji alur lengkap ke DB di .env: `npx tsx scripts/testPoaStandarisasiPusat.ts` (lolos di staging 2026-10-07; membuat lalu menghapus 1 pengajuan).

Dikonfirmasi pengguna (2026-10-06): unit = Produk × Grup RS; pembuat = 3 orang HKA; level approval = tabel yang sama dengan cabang (level ≤ level pembuat otomatis disetujui); gateway = "produk P pernah standarisasi di salah satu outlet grup → dianggap sudah ada pusat"; outlet di luar 255 outlet grup tidak kena gateway; Ahsanul = role ASD, label DIR; approver ASD/SD di-hardcode (Ahsanul / Brian); grup wajib di-import (tidak ada sumber live).

Dikonfirmasi tambahan: approval dokter juga berlaku untuk pusat (4 fase), dokter boleh dipilih dari outlet mana pun di grup.

⚠️ **Asumsi kerja** (belum dikonfirmasi): tanpa KPDM/estimasi per dokter/Step 5 (§7 Q1, tidak lagi blocking), fail-open saat data gagal dibaca (Q3), BUMN (Q2).

## Ringkasan
Divisi Hospital Key Account (HKA: Ahsanul Chalid/DIR, Widodo, Masril) mengurus standarisasi level pusat per **Grup RS** (Primaya, Siloam, Hermina, dst.). Standarisasi pusat jadi **gateway**: outlet cabang dalam grup HKA baru boleh standarisasi produk P kalau P sudah pernah distandarisasi di grup itu — lewat pengajuan pusat, atau karena salah satu outlet grup sudah memenuhi kriteria "sudah standarisasi" (sales 3 bulan DAN DPL aktif). Pengajuan pusat memakai tabel level approval diskon yang sama dengan cabang, tapi pembuatnya sudah setara NSM/ASD sehingga level di bawahnya otomatis lolos.
