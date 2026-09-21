# Form POA — Data Model

*(Retroaktif — didokumentasikan dari `prisma/schema.prisma` (1019 baris) + `scripts/sync*.ts`/`import*.ts`. Semua klaim memiliki referensi file:line. Model KPI Monitoring (`KpiMonthlyEntry`/`KpiContractEvaluation`) TIDAK didetailkan di sini — sudah memiliki spesifikasi sendiri di `docs/kpi-monitoring/02-data-model.md`.)*

## 1. Inventori model per domain

### Core POA (jantung sistem)

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `PoaForm` | 143 | 1 rencana penjualan per MR (atau atasan pengganti) per periode | `period` (teks bebas, mis. "2026-07" atau kuartal), `status` (PoaStatus), `version` (naik tiap kali kembali ke REVISI), `target`, `ownerId`, `currentHolderId` | `[ownerId]`, `[currentHolderId]`, `[status]` |
| `PoaLineItem` | 265 | 1 baris per customer×produk dalam 1 POA | Customer group (271-284), Product group (286-291), MR manual input termasuk PSSP/diskon (293-333), kolom placeholder formula (336-348, nullable/dihitung eksternal) | `[poaId]`, `[kodeRequest]` |
| `PoaAuditLog` | 357 | Trail append-only tiap transisi status/aksi POA — sumber data Lock Edit Logic (lihat `01-business-rules.md` §1) | `action` (AuditAction), `fromStatus`/`toStatus`, `snapshot` (Json), `actorId` | `[poaId]`, `[actorId]` |

**Catatan desain — invariant:**
- `PoaForm.id` (`schema.prisma:144`) — primary key UUID, tidak pernah berubah setelah dibuat; tidak ada operasi update yang menyentuh `id`.
- `PoaForm.version` (`:147`) hanya pernah bertambah (increment), tidak pernah berkurang atau di-reset — satu-satunya titik mutasinya adalah `applyTransition` saat `toStatus === REVISI` (`poaWorkflow.ts:149`).
- Kombinasi `(ownerId, period)` diharapkan unik SECARA APLIKASI, bukan constraint database — tidak ada `@@unique([ownerId, period])` pada model ini (`schema.prisma:143-165`). Ditegakkan hanya di `updatePoaPeriodAction` (`poa.ts:279-282`) saat mengubah periode; TIDAK ditegakkan di jalur pembuatan POA baru (`createPoaDraft`, `poaWorkflow.ts:494-518`) — secara teori dua request bersamaan dapat membuat dua `PoaForm` DRAFT dengan `(ownerId, period)` sama tanpa error DB. ❓ belum dikonfirmasi apakah ini pernah terjadi di production.
- `PoaLineItem.poaId` (`:267-268`) selalu merujuk `PoaForm` yang valid — foreign key dengan `onDelete: Cascade`, sehingga menghapus `PoaForm` menghapus seluruh `PoaLineItem`-nya (bukan hanya larangan orphan).
- `PoaAuditLog` bersifat **append-only untuk POA yang sudah pernah disubmit** — tidak ada pemanggilan `poaAuditLog.update` di manapun pada codebase (diverifikasi via pencarian literal). Namun **bukan append-only mutlak**: `deletePoaAction` (`poa.ts:230-249`) menghapus seluruh baris `PoaAuditLog` milik satu `poaId` sekaligus (`poaAuditLog.deleteMany`, `:243`) — tetapi aksi ini dibatasi ketat ke POA berstatus DRAFT saja (`:240`), yang menurut definisi belum pernah menghasilkan log APPROVE/SUBMIT (baru `CREATE`/`UPDATE`). Jadi begitu POA pernah melewati SUBMITTED_TO_* sekali, riwayat log-nya efektif permanen karena tidak ada lagi jalur untuk menghapusnya.

### Users & Org

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `User` | 94 | Orang + node hierarki org (self-relation) | `role` (Role enum), `jabatan` (override tampilan, lihat §2), `isDummy`, `nipAtasan`/`reportsTo`/`subordinates` (self-relation "OrgHierarchy"), `kodeWilayah`/`namaWilayah` | `[nipAtasan]`, `[role]` |

**Catatan desain — invariant:** `User.nip` (`:95`) adalah primary key sekaligus NIP asli pegawai — tidak pernah berubah selama masa aktifnya (identitas pegawai, bukan surrogate key). Seluruh relasi (`PoaForm.ownerId`, `PoaAuditLog.actorId`, dst.) memakainya sebagai FK langsung, bukan UUID terpisah.

### Customer / PSSP master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Customer` | 167 | Master data dokter | `kodeCustomer` (unique, nullable), `spesialisasi` | `[spesialisasi]`, `[namaCustomer]` |
| `CustomerOutlet` | 183 | Junction dokter × outlet, `isFokus` ("Rekomendasi PM", hanya dari sinkronisasi, tidak pernah di-set manual) | `isFokus` | unique `[customerId,kodePI]`, `[kodePI]`, `[customerId]`, `[kodePI,isFokus]` |
| `PsspHospinetSnapshot` | 205 | Snapshot PSSP level-customer untuk divisi (mis. Hospinet) yang tidak ter-cover `PsspKontrak` | `kodeCustomer` (numbering Hospinet sendiri, namespace berbeda dari `Customer.kodeCustomer` — jangan pernah cross-write), `valuePssp`, `pelunasan`, `rr` | unique `[customerId,kodePI]`, `[kodePI]` |
| `SurveyRekomendasi` | 242 | Baris survey dokter×outlet×produk rekomendasi, men-drive auto-suggest "Produk Kompetitor" | `kodeProduk` (produk rekomendasi Pharos), `historyProduk` (raw string termasuk brand kompetitor), match berdasarkan string bukan FK | unique `[kodePI,kodeCustomer,kodeProduk]`, `[kodePI,kodeCustomer]` |
| `CustomerPengajuan` | 678 | Form multi-step "daftar dokter baru"; submit → membuat `Customer`+`CustomerOutlet` | `status` (DRAFT/SUBMITTED), `rekening`/`organisasi`/`outletsPengajuan` (Json), `customerId` (terisi post-submit) | `[submittedBy]`, `[status]`, `[spesialisasi]` |
| `PsspKontrak` | 472 | Data PSSP level-kontrak, 1 baris per (kontrak×produk); diimpor dari snapshot Excel "Pelunasan" | `cUrut` (nomor kontrak), `kdCust` (link ke `Customer.kodeCustomer`), `estByPeriod`/`bmByPeriod`/`lunasByPeriod` (JSONB detail per-periode) | unique `[cUrut,kdProduk]`, `[kdCust]`, `[kdOutlet]`, `[prdAwal,prdAkhir]` |

**Catatan desain — invariant:** `Customer.kodeCustomer` (`:169`) unik apabila terisi (`@unique`), tetapi nullable — dokter yang didaftarkan manual (`isManualCustomer` di `PoaLineItem`) dapat memiliki `kodeCustomer` null sampai tersinkronisasi dari CDB. `CustomerOutlet` unik per `(customerId, kodePI)` (`:192`) — 1 dokter hanya dapat terhubung ke 1 outlet tertentu sekali, mencegah baris junction duplikat.

### Product master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Product` | 426 | Master produk, key "Kd Item" (`kodeProduk`) — satu-satunya sumber kebenaran, dari LAPORAN HNA SARUASUBUR (BEDA dari LIST PRODUK PI, sistem kode berbeda) | `hna`, `nilaiRPersen`, `satuanTerkecil`/`konversiPembagi`, field dosis (440-446), `spesialisasiRekomendasi` (String[], men-drive filter panel Produk Rekomendasi) | `[namaGroupBrand]` |

### Outlet master data

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `Outlet` | 378 | Master outlet/RS — sebagian field (kodePI, nama, sector, kota, propinsi, hierarki teritori) disinkronisasi dari Nexus API `get_outlet_by_nip` (bermigrasi dari MSSQL 2026-08-06, lihat `docs/outlet-nexus-migration/`); sebagian lain (`statusOutlet`, `kategori`, `namaChannel`, `coveredByNip`/`coveredByRole`) tetap dari `importStrukturVerifiedKAM.ts` | Hierarki teritori (GT/Sub/Area/Reg, 392-399), `coveredByNip`/`coveredByRole` (cascade tim vacant, men-drive exception `canCreatePoa`, dihitung ulang `importStrukturVerifiedKAM.ts`) | `[statusOutlet]`, `[sector]` |
| `OutletStrukturBaru` | 565 | Staging DRAFT restrukturisasi org 2026, TIDAK terhubung ke `Outlet`/`MrOutletAssignment`/approval — review saja | `gmNip..psrNip` (nullable, match berdasarkan nama) | beberapa index `[xxxNip]` |
| `MrOutletAssignment` | 884 | Junction MR × outlet per periode | unique `[nipMR,kodePI,periode]` | `[nipMR]`, `[kodePI]`, `[periode]` |
| `OutletSalesValueMonthly` | 767 | Sales value Rupiah bulanan level-outlet (bukan per-produk), dari `mkt_insight.dbo.DIR10001B`, feed kartu "Data Sales" Detail POA | `valueSales` | unique `[kodePI,periode]`, `[kodePI]`, `[periode]` |
| `OutletSalesHistory` | 727 | Jumlah sales 12 bulan rolling per (kodePI×itemKode), dari `DIR10001B` | `totalSales12Bln`, `periodeFrom`/`periodeTo` | unique `[kodePI,itemKode]` |
| `OutletSalesMonthly` | 746 | Quantity sales bulanan per outlet+produk, feed engine `targetCalculation.ts` | `qty` (unit, bukan Rupiah) | unique `[kodePI,itemKode,periode]` |
| `OutletProductKriteria` | 869 | Tag kriteria per produk per outlet (dari sheet Unpivot ProductPMDatabase), men-drive "produk kontes per outlet" | `kategori` (Low Hanging Fruit/Blue Ocean/Red Ocean), `kriteriaBaru`, `statusTransaksi` | unique `[kodePI,kodeProduk,paket]` |
| `OrgStrukturMeta` | 601 | Singleton — tracking bulan CSV struktur org yang sedang dipakai | `periode`, `sourceFile` | — |

**Catatan desain — invariant:** `Outlet.kodePI` (`:379`) adalah primary key alami (bukan UUID surrogate), dipakai langsung sebagai FK oleh `CustomerOutlet`, `MrOutletAssignment`, `SurveyRekomendasi`, dst. `MrOutletAssignment` (`:884`) unik per `(nipMR, kodePI, periode)` — 1 MR hanya bisa memiliki 1 assignment aktif per outlet per periode, mencegah duplikasi baris sinkronisasi yang berjalan berulang.

### Target

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `TargetHospitalValue` | 800 | Target sales Rupiah bulanan per teritori (GT), dari "Target Hospital (in Value).xlsx" | `namaGT`, `target`, `nip{MR,ASM,SM,NSM}` (nullable, match berdasarkan nama) | unique `[namaGT,periode]`, plus index per-nip |
| `ProductTargetInput` | 831 | **Legacy** — increment stretch bulanan per produk untuk engine rasio/produktivitas, **digantikan 2026-07-21** oleh `ProductTargetAllocation`, dipertahankan untuk view referensi "Simulasi Target Produk" | `monthlyRamp` | unique `[kodeProduk,quarter]` |
| `ProductTargetAllocation` | 853 | Mekanisme target-setting UTAMA saat ini — target manual per-produk cascading NSM→SM→ASM→MR | `nip` (level tersirat dari `User.role` pemilik NIP tersebut), `qty`; parent=sum-anak hanya dipaksa di level UI, tidak di DB | unique `[kodeProduk,quarter,nip]`, `[kodeProduk,quarter]`, `[nip]` |

**Catatan desain — invariant:** `TargetHospitalValue` unik per `(namaGT, periode)` — 1 target per teritori per bulan. `ProductTargetAllocation` unik per `(kodeProduk, quarter, nip)` — 1 baris alokasi per produk per kuartal per pemilik NIP; konsistensi "parent = sum(anak)" pada hierarki cascading TIDAK ditegakkan oleh constraint database, hanya validasi UI — lihat kolom "Field kunci" di atas.

### Discount

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `DiskonKontrak` | 618 | Sumber diskon UTAMA ("% Diskon DPL/DPF"), 1 baris per (kontrak×produk), dari "DPL \<bulan\> \<tahun\>.xlsx" | `newOnPi` (% diskon on-invoice efektif, auto-isi `PoaLineItem.avgDiskon`) | unique `[nomor,kodeProduk]`, `[kodePI]`, `[kodeProduk]`, `[prdAwal,prdAkhir]` |
| `DiskonHistory` | 662 | Sumber diskon FALLBACK, hanya dipakai apabila tidak ada `DiskonKontrak` yang cover outlet+produk+periode — flat historical MAX (berubah dari weighted-avg 2026-07-28) | `maxDiskonPct` | unique `[kodePI,kodeProduk]`, `[kodePI]` |

### Listing Fee

| Model | Baris | Fungsi | Field kunci | Index |
|---|---|---|---|---|
| `ListingFeeKontrak` | 518 | Data kontrak listing fee | `noreq`, `value`, `bmByPeriod`/`pctListingByPeriod` (JSONB) | unique `[noreq,kdProduk]`, `[kdCust]`, `[kdOutlet]`, `[prdAwal,prdAkhir]` |

### KPI Monitoring

Memiliki spesifikasi sendiri: `docs/kpi-monitoring/02-data-model.md`. Model: `KpiMonthlyEntry` (baris 912, snapshot per-personil×bulan, scorecard 4-pilar berbobot, ADMIN-only v1) dan `KpiContractEvaluation` (baris 965, agregasi evaluasi kontrak dengan override atasan atas rekomendasi sistem).

### Maintenance / ops

| Model | Baris | Fungsi |
|---|---|---|
| `MaintenanceMode` | 1012 | Singleton (id=1) switch lockout situs. `enabled` = lockout penuh (non-ADMIN diblok dari semua route); `viewOnly` (ditambah 2026-08-03) = versi lebih lunak, baca/browse tetap terbuka tetapi tiap server action mutating diblok via `assertWritable`/`isWriteBlocked`. `enabled` otomatis memblok write juga. |

**Catatan desain — invariant:** `MaintenanceMode.id` (`schema.prisma:1013`) di-default ke `1` (`@id @default(1)`) — pola singleton-row, tidak dimaksudkan pernah memiliki baris kedua; kode yang membaca konfigurasi ini selalu query by `id: 1` (lihat §7 di `03-ui-and-access.md`).

Enum lengkap: `Role`, `PoaStatus`, `AuditAction`, `StatusStandarisasi`, `JenisPssp`, `PihakPssp`, `PsSp`, `BentukPssp` — semua di `prisma/schema.prisma:12-91`.

## 2. Model User/Role

`Role` enum (`schema.prisma:12-25`): `MR, ASM, SM, NSM, GM, ADMIN, SFE, VIEWER`. Komentar VIEWER (19-24): *"Same read-only company-wide oversight as GM (every POA + full Summary, no edit/approve/create rights) — kept as a distinct role rather than reusing GM so it isn't conflated with the real General Manager title (2026-07-29 request)."*

`User.jabatan` (`schema.prisma:98-102`): *"Display-only override for what's SHOWN as this person's title (e.g. 'SPV') when their actual role/permissions are a lower level (SPV collapses to MR everywhere in this app — same approval rights, same outlet-holding rules). Null means 'just show role'."*

`nipAtasan` (`schema.prisma:116-119`): self-relation "OrgHierarchy" ke NIP atasan langsung. Hierarki: MR→ASM→SM→NSM→GM, tetapi resolusi akses (`authz.ts:19`) hanya meng-encode 4 level (`ROLE_LEVEL`: MR=0, ASM=1, SM=2, NSM=3), traversal BFS dibatasi depth 3 hop. GM/ADMIN berada di luar traversal tersebut, company-wide visibility langsung.

`isDummy` (`schema.prisma:105`): akun workshop/demo — bypass restriksi outlet-assignment, dan DIKECUALIKAN dari agregat company-wide `getSubordinateMRNips` (`authz.ts:112-120`) karena akun dummy dapat membuat POA yang terlihat nyata dan menginflasi dashboard ADMIN/GM/SFE (dikonfirmasi 63 POA milik dummy di production per komentar tersebut).

## 3. Dari mana data tiap model berasal

| Model / data | Sumber | Mekanisme | Cadence |
|---|---|---|---|
| `User` + hierarki org (`nipAtasan`) | Nexus API `get_employees`/`get_subordinates` (inferensi closest-enclosing-ancestor) — **bermigrasi dari MSSQL 2026-08-20**, lihat `docs/org-nexus-migration/`. GM di luar scope, tetap manual via `importStrukturVerifiedKAM.ts` | `scripts/syncOrg.ts` → `runOrgSync`; juga `POST /api/sync/org-structure` | Recurring, cron-triggerable |
| `Outlet` (sebagian field) + `MrOutletAssignment` | Nexus API `get_outlet_by_nip` (per NIP `role=MR` aktif dari `User`) — **bermigrasi dari MSSQL 2026-08-06**, lihat `docs/outlet-nexus-migration/` | `scripts/syncOrg.ts` → `runOutletSync` (step 2, membutuhkan User sudah ada) | Recurring |
| `Outlet.coveredByNip/coveredByRole` | Excel struktur org "Verified" | `scripts/importStrukturVerifiedKAM.ts` | Manual periodik |
| `OutletStrukturBaru` (draft 2026) | Excel "Simulasi Hospital Struktur 2026 New.xlsx" | `scripts/importStrukturBaru.ts` | One-time draft/review |
| `Customer`/`CustomerOutlet` (+`isFokus`) | Excel Customer_Database + sheet "Dokter RS NON CHAIN" | `scripts/syncCustomers.ts` (2-pass) | Recurring manual |
| `Product` (field inti) | Excel LAPORAN HNA SARUASUBUR (password-protected) | `scripts/syncProducts.ts` | Recurring manual |
| `Product.nilaiRPersen` | Excel `internal/product_r.xlsx` | `scripts/importProductR.ts` (**menggantikan** `syncNilaiR.ts`) | Periodik manual |
| `Product.satuanTerkecil`/`konversiPembagi` | Excel Kebutuhan Satuan Terkecil | `scripts/syncSatuanTerkecil.ts` | Recurring manual |
| `Product.zatAktif`/dosis | Excel List Product pharos | `scripts/syncProductZatAktifDosis.ts` | Recurring manual |
| `Product.spesialisasiRekomendasi` | Excel Rekomendasi Paket Produk Per Spesialisasi | `scripts/importProductSpesialisasiRekomendasi.ts` | One-time |
| `OutletSalesHistory` (12 bln rolling) | MSSQL `DIR10001B` | `scripts/syncSalesHistory.ts` → `runSalesHistorySync`; juga `POST /api/sync/sales-history` | Recurring, cron-triggerable |
| `OutletSalesMonthly` (qty per produk) | MSSQL `DIR10001B` | `scripts/syncSalesHistoryMonthly.ts`; juga in-process scheduler (`src/instrumentation.ts` → `salesHistoryMonthlyScheduler.ts`, no external cron needed) | Recurring, auto-triggered daily 00:00 WIB |
| `OutletSalesValueMonthly` (Rupiah level-outlet) | MSSQL `DIR10001B` | `scripts/syncOutletSalesValueMonthly.ts`; juga `POST /api/sync/sales-value-monthly` (masih ada, fallback) DAN in-process scheduler (`src/instrumentation.ts` → `outletSalesValueMonthlyScheduler.ts`, ditambahkan 2026-09-08 setelah cron eksternal-nya diam-diam berhenti jalan — data sempat mandek di periode 202606) | Recurring, auto-triggered daily 00:00 WIB |
| `PsspKontrak` | Excel snapshot "Pelunasan" (~30k baris, full-replace) | `scripts/importPsspKontrak.ts` | Periodik manual |
| `PsspHospinetSnapshot` | Excel sumber Hospinet | `scripts/importPsspHospinet.ts` | Periodik manual |
| `DiskonKontrak` (DPL, sumber utama) | Excel `DPL <bulan tahun>.xlsx` | `scripts/importDpl.ts` | Periodik manual |
| `DiskonHistory` (fallback) | Excel Data Diskon All Product (~490k baris, streamed) | `scripts/importDiskonHistory.ts` | Periodik manual |
| `ListingFeeKontrak` | Excel Listing Fee KAM | `scripts/importListingFee.ts` | Periodik manual |
| `TargetHospitalValue` | Excel "Target Hospital (in Value).xlsx" | `scripts/importTargetHospitalValue.ts` (range periode 202608-202612 fixed); 202608-202609 di-refresh 2026-09-21 dari "Target Hospital (in Value) (4).xlsx" sheet "Compile Target MR" via `scripts/importTargetHospitalValueCompileMR.ts` (sheet tanpa kolom GT — namaGT di-resolve ke struktur live lewat NIP/kodeGT/nama, prefix "PROJECT" dianggap sama; `--apply` upsert, `--prune` hapus duplikat ejaan lama) | One-time |
| `SurveyRekomendasi` | Excel Data Rekomendasi Final | `scripts/importSurveyRekomendasi.ts` | Periodik manual |
| `OutletProductKriteria` | Excel sheet Unpivot ProductPMDatabase | `scripts/seedOutletProductKriteria.ts` | One-time |
| Histori visit (3 bulan, dokter/outlet) | API eksternal **Exodus Activity** (BEDA dari Nexus, lihat `03-ui-and-access.md`) | `src/lib/exodusApi.ts`, OAuth2 client_credentials, degradasi ke `null` apabila tidak dikonfigurasi | Live/on-demand, bukan sync batch |
| `PoaForm`/`PoaLineItem`/`PoaAuditLog`/`CustomerPengajuan` | Input manual UI | Server actions | Real-time (user-triggered) |
| `ProductTargetAllocation` | Input manual UI (admin/NSM cascading) | Server actions | Real-time |

**Penamaan script**: `sync*` = dimaksudkan untuk berjalan berulang (refresh Excel/pull MSSQL, sebagian cron-triggerable via `/api/sync/*`); `import*` = load ad-hoc/manual data pada titik waktu tertentu, sebagian eksplisit menggantikan versi `import*` lama yang sama.

**MSSQL (`mkt_insight`)**: read-only satu arah — package npm `mssql` melalui `MSSQL_CONNECTION_STRING`. Hanya membaca 1 tabel sekarang: `mkt_insight.dbo.DIR10001B` (sales) — `Struktur_Marketing_PI` (org) sudah tidak dipakai lagi sejak cutover org-structure ke Nexus 2026-08-20. Tidak ada `INSERT`/`UPDATE`/`DELETE` ke MSSQL di manapun pada `src/lib/sync/*.ts` — semua tulisan mendarat di Postgres (Prisma) milik aplikasi ini sendiri.

**Nexus (`api-nexus.pharos.id`)**: API eksternal publik (tanpa auth, dikonfirmasi 2026-07-23). Selain `get_customer_by_outlet` (live-merge di `getCustomersByOutlet`, lihat §"Customer" di atas): sejak 2026-08-06 `get_outlet_by_nip` menjadi sumber sebagian field `Outlet` + `MrOutletAssignment` (`runOutletSync`, dipanggil per NIP `role=MR` aktif, lihat `docs/outlet-nexus-migration/`); sejak 2026-08-20 `get_employees`/`get_subordinates` menjadi sumber `User` + `nipAtasan` (`runOrgSync`, lihat `docs/org-nexus-migration/`).

**Perilaku kegagalan sinkronisasi** (`src/app/api/sync/org-structure/route.ts`, `sales-history/route.ts:26-36`, `sales-value-monthly/route.ts:26-36` — pola identik di ketiganya): berbeda dari integrasi Nexus/Exodus lain (§6 `03-ui-and-access.md`) yang mendegradasi UI secara silent ke `null`, ketiga route sync ini **gagal secara eksplisit (fail loud)** — exception ditangkap, di-log ke `console.error`, dan direspons dengan HTTP 500 berisi pesan error (`{ error: "Sync failed", detail: String(err) }`). Route ini dipanggil oleh cron eksternal (bukan diakses langsung dari UI), sehingga kegagalannya tidak pernah membuat halaman aplikasi crash — dampaknya adalah data sync yang stale sampai retry cron berikutnya berhasil, bukan gangguan pada request pengguna yang sedang berjalan. `sales-history`/`sales-value-monthly` menolak jalan apabila `MSSQL_CONNECTION_STRING` tidak di-set (500, `"MSSQL_CONNECTION_STRING not configured"`); `org-structure` sudah tidak butuh itu lagi sejak cutover Nexus. Ketiganya membutuhkan header `X-Sync-Secret` yang cocok dengan env `SYNC_SECRET` apabila env tersebut di-set (401 jika tidak cocok).

Lihat juga: `docs/PERFORMANCE.md` untuk constraint query company-wide (relevan apabila menambah model/query yang dapat diakses ADMIN/GM/NSM secara luas).
