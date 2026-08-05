# Form POA — Data Model

*(Retroaktif — didokumentasiin dari `prisma/schema.prisma` (1019 baris) + `scripts/sync*.ts`/`import*.ts`. Semua klaim ada file:line-nya. Model KPI Monitoring (`KpiMonthlyEntry`/`KpiContractEvaluation`) TIDAK didetailin di sini — udah ada spec sendiri di `docs/kpi-monitoring/02-data-model.md`.)*

## 1. Inventori model per domain

### Core POA (jantung sistem)

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `PoaForm` | 143 | 1 rencana penjualan per MR (atau atasan pengganti) per periode | `period` (teks bebas, mis. "2026-07" atau kuartal), `status` (PoaStatus), `version` (naik tiap balik REVISI), `target`, `ownerId`, `currentHolderId` | `[ownerId]`, `[currentHolderId]`, `[status]` |
| `PoaLineItem` | 265 | 1 baris per customer×produk dalam 1 POA | Customer group (271-284), Product group (286-291), MR manual input incl. PSSP/diskon (293-333), kolom placeholder formula (336-348, nullable/dihitung eksternal) | `[poaId]`, `[kodeRequest]` |
| `PoaAuditLog` | 357 | Trail append-only tiap transisi status/aksi POA — sumber data Lock Edit Logic (lihat `01-business-rules.md` §1) | `action` (AuditAction), `fromStatus`/`toStatus`, `snapshot` (Json), `actorId` | `[poaId]`, `[actorId]` |

### Users & Org

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `User` | 94 | Orang + node hierarki org (self-relation) | `role` (Role enum), `jabatan` (override tampilan, lihat §2), `isDummy`, `nipAtasan`/`reportsTo`/`subordinates` (self-relation "OrgHierarchy"), `kodeWilayah`/`namaWilayah` | `[nipAtasan]`, `[role]` |

### Customer / PSSP master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Customer` | 167 | Master data dokter | `kodeCustomer` (unique, nullable), `spesialisasi` | `[spesialisasi]`, `[namaCustomer]` |
| `CustomerOutlet` | 183 | Junction dokter × outlet, `isFokus` ("Rekomendasi PM", cuma dari sync, gak pernah di-set manual) | `isFokus` | unique `[customerId,kodePI]`, `[kodePI]`, `[customerId]`, `[kodePI,isFokus]` |
| `PsspHospinetSnapshot` | 205 | Snapshot PSSP level-customer buat divisi (mis. Hospinet) yang gak ke-cover `PsspKontrak` | `kodeCustomer` (numbering Hospinet sendiri, namespace beda dari `Customer.kodeCustomer` — jangan pernah cross-write), `valuePssp`, `pelunasan`, `rr` | unique `[customerId,kodePI]`, `[kodePI]` |
| `SurveyRekomendasi` | 242 | Baris survey dokter×outlet×produk rekomendasi, drive auto-suggest "Produk Kompetitor" | `kodeProduk` (produk rekomendasi Pharos), `historyProduk` (raw string termasuk brand kompetitor), match by string bukan FK | unique `[kodePI,kodeCustomer,kodeProduk]`, `[kodePI,kodeCustomer]` |
| `CustomerPengajuan` | 678 | Form multi-step "daftar dokter baru"; submit → bikin `Customer`+`CustomerOutlet` | `status` (DRAFT/SUBMITTED), `rekening`/`organisasi`/`outletsPengajuan` (Json), `customerId` (keisi post-submit) | `[submittedBy]`, `[status]`, `[spesialisasi]` |
| `PsspKontrak` | 472 | Data PSSP level-kontrak, 1 baris per (kontrak×produk); import dari snapshot Excel "Pelunasan" | `cUrut` (nomor kontrak), `kdCust` (link ke `Customer.kodeCustomer`), `estByPeriod`/`bmByPeriod`/`lunasByPeriod` (JSONB detail per-periode) | unique `[cUrut,kdProduk]`, `[kdCust]`, `[kdOutlet]`, `[prdAwal,prdAkhir]` |

### Product master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Product` | 426 | Master produk, key "Kd Item" (`kodeProduk`) — satu-satunya sumber kebenaran, dari LAPORAN HNA SARUASUBUR (BEDA dari LIST PRODUK PI, sistem kode beda) | `hna`, `nilaiRPersen`, `satuanTerkecil`/`konversiPembagi`, field dosis (440-446), `spesialisasiRekomendasi` (String[], drive filter panel Produk Rekomendasi) | `[namaGroupBrand]` |

### Outlet master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Outlet` | 378 | Master outlet/RS, sync dari Struktur_Marketing_PI | Hierarki teritori (GT/Sub/Area/Reg, 392-399), `coveredByNip`/`coveredByRole` (cascade tim vacant, drive exception `canCreatePoa`, dihitung ulang `importStrukturVerifiedKAM.ts`) | `[statusOutlet]`, `[sector]` |
| `OutletStrukturBaru` | 565 | Staging DRAFT restrukturisasi org 2026, TIDAK terhubung ke `Outlet`/`MrOutletAssignment`/approval — review doang | `gmNip..psrNip` (nullable, match by name) | beberapa index `[xxxNip]` |
| `MrOutletAssignment` | 884 | Junction MR × outlet per periode | unique `[nipMR,kodePI,periode]` | `[nipMR]`, `[kodePI]`, `[periode]` |
| `OutletSalesValueMonthly` | 767 | Sales value Rupiah bulanan level-outlet (bukan per-produk), dari `mkt_insight.dbo.DIR10001B`, feed kartu "Data Sales" Detail POA | `valueSales` | unique `[kodePI,periode]`, `[kodePI]`, `[periode]` |
| `OutletSalesHistory` | 727 | Jumlah sales 12 bulan rolling per (kodePI×itemKode), dari `DIR10001B` | `totalSales12Bln`, `periodeFrom`/`periodeTo` | unique `[kodePI,itemKode]` |
| `OutletSalesMonthly` | 746 | Quantity sales bulanan per outlet+produk, feed engine `targetCalculation.ts` | `qty` (unit, bukan Rupiah) | unique `[kodePI,itemKode,periode]` |
| `OutletProductKriteria` | 869 | Tag kriteria per produk per outlet (dari sheet Unpivot ProductPMDatabase), drive "produk fokus per outlet" | `kategori` (Low Hanging Fruit/Blue Ocean/Red Ocean), `kriteriaBaru`, `statusTransaksi` | unique `[kodePI,kodeProduk,paket]` |
| `OrgStrukturMeta` | 601 | Singleton — tracking bulan CSV struktur org yang lagi dipake | `periode`, `sourceFile` | — |

### Target

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `TargetHospitalValue` | 800 | Target sales Rupiah bulanan per teritori (GT), dari "Target Hospital (in Value).xlsx" | `namaGT`, `target`, `nip{MR,ASM,SM,NSM}` (nullable, match by name) | unique `[namaGT,periode]`, plus index per-nip |
| `ProductTargetInput` | 831 | **Legacy** — increment stretch bulanan per produk buat engine rasio/produktivitas, **digantikan 2026-07-21** oleh `ProductTargetAllocation`, dipertahankan buat view referensi "Simulasi Target Produk" | `monthlyRamp` | unique `[kodeProduk,quarter]` |
| `ProductTargetAllocation` | 853 | Mekanisme target-setting UTAMA sekarang — target manual per-produk cascading NSM→SM→ASM→MR | `nip` (level tersirat dari `User.role` NIP itu), `qty`; parent=sum-anak cuma dipaksa di level UI, gak di DB | unique `[kodeProduk,quarter,nip]`, `[kodeProduk,quarter]`, `[nip]` |

### Discount

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `DiskonKontrak` | 618 | Sumber diskon UTAMA ("% Diskon DPL/DPF"), 1 baris per (kontrak×produk), dari "DPL \<bulan\> \<tahun\>.xlsx" | `newOnPi` (% diskon on-invoice efektif, auto-isi `PoaLineItem.avgDiskon`) | unique `[nomor,kodeProduk]`, `[kodePI]`, `[kodeProduk]`, `[prdAwal,prdAkhir]` |
| `DiskonHistory` | 662 | Sumber diskon FALLBACK, cuma dipake kalau gak ada `DiskonKontrak` yang cover outlet+produk+periode — flat historical MAX (berubah dari weighted-avg 2026-07-28) | `maxDiskonPct` | unique `[kodePI,kodeProduk]`, `[kodePI]` |

### Listing Fee

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `ListingFeeKontrak` | 518 | Data kontrak listing fee | `noreq`, `value`, `bmByPeriod`/`pctListingByPeriod` (JSONB) | unique `[noreq,kdProduk]`, `[kdCust]`, `[kdOutlet]`, `[prdAwal,prdAkhir]` |

### KPI Monitoring

Punya spec sendiri: `docs/kpi-monitoring/02-data-model.md`. Model: `KpiMonthlyEntry` (baris 912, snapshot per-personil×bulan, scorecard 4-pilar berbobot, ADMIN-only v1) dan `KpiContractEvaluation` (baris 965, agregasi evaluasi kontrak dgn override atasan atas rekomendasi sistem).

### Maintenance / ops

| Model | Baris | Fungsi |
|---|---|---|
| `MaintenanceMode` | 1012 | Singleton (id=1) switch lockout situs. `enabled` = lockout penuh (non-ADMIN diblok dari semua route); `viewOnly` (ditambah 2026-08-03) = versi lebih lunak, baca/browse tetep kebuka tapi tiap server action mutating diblok via `assertWritable`/`isWriteBlocked`. `enabled` otomatis nge-block write juga. |

Enum lengkap: `Role`, `PoaStatus`, `AuditAction`, `StatusStandarisasi`, `JenisPssp`, `PihakPssp`, `PsSp`, `BentukPssp` — semua di `prisma/schema.prisma:12-91`.

## 2. Model User/Role

`Role` enum (`schema.prisma:12-25`): `MR, ASM, SM, NSM, GM, ADMIN, SFE, VIEWER`. Komentar VIEWER (19-24): *"Same read-only company-wide oversight as GM (every POA + full Summary, no edit/approve/create rights) — kept as a distinct role rather than reusing GM so it isn't conflated with the real General Manager title (2026-07-29 request)."*

`User.jabatan` (`schema.prisma:98-102`): *"Display-only override for what's SHOWN as this person's title (e.g. 'SPV') when their actual role/permissions are a lower level (SPV collapses to MR everywhere in this app — same approval rights, same outlet-holding rules). Null means 'just show role'."*

`nipAtasan` (`schema.prisma:116-119`): self-relation "OrgHierarchy" ke NIP atasan langsung. Hierarki: MR→ASM→SM→NSM→GM, tapi resolusi akses (`authz.ts:19`) cuma encode 4 level (`ROLE_LEVEL`: MR=0, ASM=1, SM=2, NSM=3), traversal BFS dibatasin depth 3 hop. GM/ADMIN di luar traversal itu, company-wide visibility langsung.

`isDummy` (`schema.prisma:105`): akun workshop/demo — bypass restriksi outlet-assignment, dan DIKECUALIKAN dari agregat company-wide `getSubordinateMRNips` (`authz.ts:112-120`) karena akun dummy bisa bikin POA yang keliatan nyata dan nge-inflate dashboard ADMIN/GM/SFE (dikonfirmasi 63 POA milik dummy di production per komentar itu).

## 3. Dari mana data tiap model berasal

| Model / data | Sumber | Mekanisme | Cadence |
|---|---|---|---|
| `User` + hierarki org | MSSQL `Struktur_Marketing_PI` | `scripts/syncOrg.ts` → `runOrgSync`; juga `POST /api/sync/org-structure` | Recurring, cron-triggerable |
| `Outlet` + `MrOutletAssignment` | MSSQL `Struktur_Marketing_PI` | `scripts/syncOrg.ts` → `runOutletSync` (step 2, butuh User udah ada) | Recurring |
| `Outlet.coveredByNip/coveredByRole` | Excel struktur org "Verified" | `scripts/importStrukturVerifiedKAM.ts` | Manual periodik |
| `OutletStrukturBaru` (draft 2026) | Excel "Simulasi Hospital Struktur 2026 New.xlsx" | `scripts/importStrukturBaru.ts` | One-time draft/review |
| `Customer`/`CustomerOutlet` (+`isFokus`) | Excel Customer_Database + sheet "Dokter RS NON CHAIN" | `scripts/syncCustomers.ts` (2-pass) | Recurring manual |
| `Product` (field inti) | Excel LAPORAN HNA SARUASUBUR (password-protected) | `scripts/syncProducts.ts` | Recurring manual |
| `Product.nilaiRPersen` | Excel `internal/product_r.xlsx` | `scripts/importProductR.ts` (**menggantikan** `syncNilaiR.ts`) | Periodik manual |
| `Product.satuanTerkecil`/`konversiPembagi` | Excel Kebutuhan Satuan Terkecil | `scripts/syncSatuanTerkecil.ts` | Recurring manual |
| `Product.zatAktif`/dosis | Excel List Product pharos | `scripts/syncProductZatAktifDosis.ts` | Recurring manual |
| `Product.spesialisasiRekomendasi` | Excel Rekomendasi Paket Produk Per Spesialisasi | `scripts/importProductSpesialisasiRekomendasi.ts` | One-time |
| `OutletSalesHistory` (12 bln rolling) | MSSQL `DIR10001B` | `scripts/syncSalesHistory.ts` → `runSalesHistorySync`; juga `POST /api/sync/sales-history` | Recurring, cron-triggerable |
| `OutletSalesMonthly` (qty per produk) | MSSQL `DIR10001B` | `scripts/syncSalesHistoryMonthly.ts` | Recurring |
| `OutletSalesValueMonthly` (Rupiah level-outlet) | MSSQL `DIR10001B` | `scripts/syncOutletSalesValueMonthly.ts`; juga `POST /api/sync/sales-value-monthly` | Recurring, cron-triggerable |
| `PsspKontrak` | Excel snapshot "Pelunasan" (~30k baris, full-replace) | `scripts/importPsspKontrak.ts` | Periodik manual |
| `PsspHospinetSnapshot` | Excel sumber Hospinet | `scripts/importPsspHospinet.ts` | Periodik manual |
| `DiskonKontrak` (DPL, sumber utama) | Excel `DPL <bulan tahun>.xlsx` | `scripts/importDpl.ts` | Periodik manual |
| `DiskonHistory` (fallback) | Excel Data Diskon All Product (~490k baris, streamed) | `scripts/importDiskonHistory.ts` | Periodik manual |
| `ListingFeeKontrak` | Excel Listing Fee KAM | `scripts/importListingFee.ts` | Periodik manual |
| `TargetHospitalValue` | Excel "Target Hospital (in Value).xlsx" | `scripts/importTargetHospitalValue.ts` (range periode 202608-202612 fixed) | One-time |
| `SurveyRekomendasi` | Excel Data Rekomendasi Final | `scripts/importSurveyRekomendasi.ts` | Periodik manual |
| `OutletProductKriteria` | Excel sheet Unpivot ProductPMDatabase | `scripts/seedOutletProductKriteria.ts` | One-time |
| Histori visit (3 bulan, dokter/outlet) | API eksternal **Exodus Activity** (BEDA dari Nexus, lihat `03-ui-and-access.md`) | `src/lib/exodusApi.ts`, OAuth2 client_credentials, degrade ke `null` kalau gak dikonfigurasi | Live/on-demand, bukan sync batch |
| `PoaForm`/`PoaLineItem`/`PoaAuditLog`/`CustomerPengajuan` | Input manual UI | Server actions | Real-time (user-triggered) |
| `ProductTargetAllocation` | Input manual UI (admin/NSM cascading) | Server actions | Real-time |

**Penamaan script**: `sync*` = dimaksudkan jalan berulang (refresh Excel/pull MSSQL, sebagian cron-triggerable via `/api/sync/*`); `import*` = load ad-hoc/manual data di titik waktu tertentu, beberapa eksplisit menggantikan `import*` versi lama yang sama.

**MSSQL (`mkt_insight`)**: read-only satu arah — `mssql` npm package via `MSSQL_CONNECTION_STRING`. Cuma baca 2 tabel: `Struktur_Marketing_PI` (org/outlet) dan `mkt_insight.dbo.DIR10001B` (sales). Gak ada `INSERT`/`UPDATE`/`DELETE` ke MSSQL di manapun di `src/lib/sync/*.ts` — semua tulisan landing di Postgres (Prisma) app ini sendiri.

Lihat juga: `docs/PERFORMANCE.md` buat constraint query company-wide (relevan kalau nambah model/query yang bisa diakses ADMIN/GM/NSM luas).
