# Target Non-Hospital Value — UI & Access

## Role/access matrix

Sama persis pola `GET /api/target-value` (bukan RBAC baru — generalisasi dari pola yang sudah ada, lihat `src/app/api/target-value/route.ts`):

| Caller | Bisa lihat |
|---|---|
| Session `ADMIN` | Semua nip/GT/divisi, bebas |
| Session `NSM` | Dipaksa `nip` = nip sendiri (subtree sendiri saja lewat `getSubordinateMRNips`); `?namaGT=` diabaikan kalau `nip` beda |
| Session role lain (MR/ASM/SM/GM/VIEWER/SD) | Ditolak 403 — sama seperti hospital, cuma NSM/ADMIN yang boleh akses endpoint ini langsung |
| Basic Auth (`PoaDoctorsApiCredential`) | Sama seperti hospital: bebas akses `?nip=` siapapun (MR/ASM/SM/NSM) atau `?namaGT=`/all |

`?nip=` menerima role MR/ASM/SM/NSM (`SUPPORTED_ROLES`) — `getSubordinateMRNips` dipakai ulang apa adanya, generik lintas project.

## Halaman

Tidak ada halaman baru — endpoint API-only (lihat Non-goals). Dipakai lewat `GET /api/target-value?divisi=non-hospital` (digabung ke endpoint hospital, bukan route terpisah — lihat `docs/API.md`).

## Non-goals v1

- **Tidak ada UI admin edit manual** (spt `/admin/target-value` + `TargetHospitalValueForm.tsx` utk hospital) — user cuma minta kemampuan GET/query, bukan CRUD form. Kalau nanti dibutuhkan, ikuti pola `targetHospitalValue.ts` action file (`searchTargetHospitalValueAction`/`updateTargetHospitalValueAction`) apa adanya.
- **Tidak ada resolusi ASM/NSM tersimpan** — subtree ASM/NSM di-resolve LIVE lewat `getSubordinateMRNips`, bukan kolom snapshot di tabel (lihat `02-data-model.md`). Konsekuensi: tidak ada filter "cari berdasarkan nama ASM/NSM" spt `searchTargetHospitalValueAction` hospital punya (yang itu pun bagian dari UI admin yang juga di-skip di v1 ini).
- **Tidak ada scheduled/cron sync** — import lewat script manual (`scripts/importTargetNonHospitalValue.ts`), dijalankan manual tiap kali Excel sumber di-update, sama seperti `importTargetHospitalValue.ts` (tidak ada cron utk hospital-nya juga).
