import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

// ─── Kontes products (all namaGroupBrand = ETHICAL, satuan = "—") ────────────
const PRODUCTS = [
  { kodeProduk: "005327", namaProduk: "NARFOZ 4 INJEKSI",                      hna: 165000,   nilaiR: 0.15  },
  { kodeProduk: "015942", namaProduk: "NARFOZ 4 MG/5 ML SYRUP 30 ML",          hna: 64062,    nilaiR: 0.144 },
  { kodeProduk: "008870", namaProduk: "NARFOZ 4 MG/5 ML SYRUP 60 ML",          hna: 99000,    nilaiR: 0.178 },
  { kodeProduk: "003171", namaProduk: "NARFOZ 4 TABLET",                        hna: 181500,   nilaiR: 0.15  },
  { kodeProduk: "005338", namaProduk: "NARFOZ 8 INJEKSI",                       hna: 372500,   nilaiR: 0.15  },
  { kodeProduk: "003182", namaProduk: "NARFOZ 8 TABLET",                        hna: 315000,   nilaiR: 0.15  },
  { kodeProduk: "006064", namaProduk: "PRORIS SUPPOSITORIA",                    hna: 71500,    nilaiR: 0.087 },
  { kodeProduk: "013390", namaProduk: "ACETRAM 37.5/325MG FC TABLET",           hna: 105000,   nilaiR: 0.125 },
  { kodeProduk: "008198", namaProduk: "REMITAL 10 MG FC TABLET",                hna: 889875,   nilaiR: 0.133 },
  { kodeProduk: "008187", namaProduk: "REMITAL 5 MG FC TABLET",                 hna: 540000,   nilaiR: 0.133 },
  { kodeProduk: "012818", namaProduk: "ZIGAT 400 MG FC TABLET",                 hna: 383500,   nilaiR: 0.15  },
  { kodeProduk: "004810", namaProduk: "ANTIPRESTIN 20 KAPSUL",                  hna: 164450,   nilaiR: 0.136 },
  { kodeProduk: "007550", namaProduk: "PRAXION 100MG/ML DROPS SUSPENSI",        hna: 27300,    nilaiR: 0.134 },
  { kodeProduk: "006119", namaProduk: "OZEN DROPS 12 ML",                       hna: 65000,    nilaiR: 0.114 },
  { kodeProduk: "010398", namaProduk: "ARCOLASE 20 MG EC TABLET",               hna: 311750,   nilaiR: 0.16  },
  { kodeProduk: "004800", namaProduk: "ANTIPRESTIN 10 KAPSUL",                  hna: 105600,   nilaiR: 0.136 },
  { kodeProduk: "010805", namaProduk: "APRION 150 MG CAPSULE",                  hna: 220000,   nilaiR: 0.2   },
  { kodeProduk: "012884", namaProduk: "APRION 75 MG CAPSULE",                   hna: 72500,    nilaiR: 0.2   },
  { kodeProduk: "004865", namaProduk: "INTRIX 1 G INJEKSI",                     hna: 283500,   nilaiR: 0.14  },
  { kodeProduk: "011223", namaProduk: "GRAMET 3 MG/3 ML INJECTION",             hna: 525000,   nilaiR: 0.2   },
  { kodeProduk: "014545", namaProduk: "PROSMOL 0.25 MG/5 ML INJECTION",         hna: 500000,   nilaiR: 0.2   },
  { kodeProduk: "008528", namaProduk: "PLEXION 50 MG TABLET SC",                hna: 300000,   nilaiR: 0.2   },
  { kodeProduk: "011290", namaProduk: "AZTRIN 500 MG DRY INJECTION",            hna: 160000,   nilaiR: 0.17  },
  { kodeProduk: "015777", namaProduk: "HUMAN ALBUMIN GRIFOLS 20 % INFUSION 100", hna: 2000000, nilaiR: 0.067 },
  { kodeProduk: "013401", namaProduk: "EVIDUR 120 MG FC TABLET",                hna: 270000,   nilaiR: 0.15  },
  { kodeProduk: "020771", namaProduk: "REMITAL 10 MG ODT",                      hna: 567000,   nilaiR: 0.15  },
];

const MRS = [
  { nip: "P080285", name: "ANGGA SATRIA PUTRA",               asmNip: "L100218", smNip: "L230089" },
  { nip: "P121533", name: "BAMBANG IRAWAN",                   asmNip: "L100218", smNip: "L230089" },
  { nip: "P230526", name: "FITRI SAFIRA ANDINI",              asmNip: "L100218", smNip: "L230089" },
  { nip: "P070068", name: "IBNU SUBARDI",                     asmNip: "L220022", smNip: "P110681" },
  { nip: "L260055", name: "NOVITA RIA DAMAYANTI",             asmNip: "L220022", smNip: "P110681" },
  { nip: "L250254", name: "DWI SAPUTRO WIBOWO",               asmNip: "L220038", smNip: "L230089" },
  { nip: "L260340", name: "ADETYA PERDHANA NASUTION",         asmNip: "L260128", smNip: "P050851" },
  { nip: "L260339", name: "RAJA ANUGRAH PUTRA VANSIA SIAHAAN", asmNip: "L260128", smNip: "P050851" },
  { nip: "P240047", name: "VANY NOVRIYANTI",                  asmNip: "L260128", smNip: "P050851" },
  { nip: "P240138", name: "FIRMAN RACHMAN SIDDIQ",            asmNip: "L260392", smNip: "P110681" },
  { nip: "P020288", name: "NOFI INDRA",                       asmNip: "P040697", smNip: "P050851" },
  { nip: "L230090", name: "NOFRI WANDI PUTRA",                asmNip: "P040697", smNip: "P050851" },
  { nip: "P260077", name: "REYNOLD FERRY YUNANDA",            asmNip: "P040697", smNip: "P050851" },
  { nip: "L090657", name: "LUCCO BOER",                       asmNip: "P060213", smNip: "L230089" },
  { nip: "L260376", name: "RIO FRANS SIAHALA S",              asmNip: "P060213", smNip: "L230089" },
  { nip: "L220015", name: "DONI KURNIAWAN PUTRA",             asmNip: "P250055", smNip: "P050851" },
  { nip: "L260134", name: "RAHMILIA",                         asmNip: "P250055", smNip: "P050851" },
];

const NSM_NIP = "P240245";
const PERIOD  = "2026-Q3";

// Real workflow statuses (APPROVE skips APPROVED_BY_ASM/SM, goes straight to SUBMITTED_TO_*)
const STATUSES = [
  "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",
  "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",   "APPROVED_BY_NSM",
  "SUBMITTED_TO_NSM",  "SUBMITTED_TO_NSM",  "SUBMITTED_TO_NSM",
  "SUBMITTED_TO_SM",   "SUBMITTED_TO_SM",   "SUBMITTED_TO_ASM",  "SUBMITTED_TO_ASM",
];

const SPECIALTIES  = ["SP.PD", "SP.AN", "SP.OB", "SP.BED", "SP.JP", "SP.THT", "SP.ANAK", "UMUM", "SP.NEURO", "SP.ONKO"];
const STANDAR_STATUS = ["SUDAH_STANDARISASI", "PROSES_PENGAJUAN", "BELUM_STANDARISASI"];

const DOCTOR_NAMES = [
  "DR. AHMAD FAUZI", "DR. SITI RAHAYU", "DR. BUDI SANTOSO",
  "DR. DEWI KUSUMA", "DR. ANDI PRASETYO", "DR. RINI WULANDARI",
  "DR. HENDRA WIJAYA", "DR. MAYA SARI", "DR. RIZKI PRATAMA",
  "DR. LESTARI NINGSIH", "DR. FAJAR NUGROHO", "DR. INDIRA PUTRI",
  "DR. WAHYU HIDAYAT", "DR. NOVIA ANGGRAINI", "DR. DIMAS KURNIA",
  "DR. FITRIA HANDAYANI", "DR. ARIF RAHMAN", "DR. SARI DEWI",
  "DR. PRABU WICAKSONO", "DR. WINDA LESTARI", "DR. TOMMY IRAWAN",
  "DR. RATIH PUSPITA", "DR. BAGAS SAPUTRA", "DR. CANDRA DEWI",
  "DR. EKO CAHYONO", "DR. FITRIANI RAHMA", "DR. GITA PERMATA",
  "DR. HARTO SUSENO", "DR. IKA RAHMAWATI", "DR. JOKO SANTOSO",
  "DR. KEVIN MAULANA", "DR. LARASATI PUTRI", "DR. MARIO EFFENDI",
  "DR. NILAM KUSUMA", "DR. OSCAR BUDIMAN", "DR. PUTRI ANJANI",
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function currentHolderNip(status, mr) {
  if (status === "SUBMITTED_TO_ASM") return mr.asmNip;
  if (status === "SUBMITTED_TO_SM")  return mr.smNip;
  if (status === "SUBMITTED_TO_NSM") return NSM_NIP;
  return null; // APPROVED_BY_NSM
}

function dec(v) { return new Prisma.Decimal(v); }

async function main() {
  const allAssignments = await prisma.mrOutletAssignment.findMany({
    where: { nipMR: { in: MRS.map(m => m.nip) } },
  });

  const assignByMR = {};
  for (const a of allAssignments) {
    if (!assignByMR[a.nipMR]) assignByMR[a.nipMR] = [];
    assignByMR[a.nipMR].push(a.kodePI);
  }

  const allKodePI  = [...new Set(allAssignments.map(a => a.kodePI))];
  const outletRows = await prisma.outlet.findMany({ where: { kodePI: { in: allKodePI } } });
  const outletMap  = new Map(outletRows.map(o => [o.kodePI, o]));

  let totalForms = 0, totalItems = 0;

  for (let mi = 0; mi < MRS.length; mi++) {
    const mr      = MRS[mi];
    const status  = STATUSES[mi];
    const seed    = hashStr(mr.nip);
    const outlets = (assignByMR[mr.nip] ?? []).slice(0, 6);

    if (outlets.length === 0) {
      console.log(`  ⚠ ${mr.name}: no outlets, skipping`);
      continue;
    }

    const poaId    = randomUUID();
    const holderId = currentHolderNip(status, mr);

    const lineItemsData = [];
    const usedDoctors   = new Set();
    let doctorIdx = seed % DOCTOR_NAMES.length;

    for (let oi = 0; oi < outlets.length; oi++) {
      const kodePI = outlets[oi];
      const outlet = outletMap.get(kodePI);
      if (!outlet) continue;

      const doctorsPerOutlet = 2 + ((seed + oi) % 3);
      for (let di = 0; di < doctorsPerOutlet; di++) {
        while (usedDoctors.has(DOCTOR_NAMES[doctorIdx % DOCTOR_NAMES.length])) doctorIdx++;
        const namaCust = DOCTOR_NAMES[doctorIdx % DOCTOR_NAMES.length];
        usedDoctors.add(namaCust);
        doctorIdx++;

        const spesialisasi = SPECIALTIES[(seed + oi + di) % SPECIALTIES.length];
        const role         = spesialisasi === "UMUM" ? "Dokter Umum" : "Dokter Spesialis";
        const prodCount    = 2 + ((seed + oi + di) % 3);
        const prodStart    = (seed + oi * 7 + di * 3) % PRODUCTS.length;
        const usedProds    = new Set();

        for (let pi = 0; pi < prodCount; pi++) {
          let prodIdx = (prodStart + pi) % PRODUCTS.length;
          let tries = 0;
          while (usedProds.has(prodIdx) && tries < PRODUCTS.length) { prodIdx = (prodIdx + 1) % PRODUCTS.length; tries++; }
          usedProds.add(prodIdx);

          const prod         = PRODUCTS[prodIdx];
          const resep        = 2 + ((seed + oi + di + pi) % 4);
          const qty          = 1 + ((seed + pi) % 2);
          const hari         = 18 + ((seed + di) % 5);
          const lama         = 3 + ((seed + pi * 2) % 3);
          const hariKerja    = 20 + (seed % 3);
          const totalBiaya   = Math.round(resep * qty * hari * prod.hna * lama);
          const visitMinggu  = 1 + ((seed + oi) % 3);

          // % stored as fraction (0.15 = 15%)
          const psspDokter   = parseFloat(prod.nilaiR.toFixed(4));
          const diskon       = parseFloat(((2 + ((seed + pi) % 5)) / 100).toFixed(4));
          const entertain    = parseFloat(((1 + ((seed + di + pi) % 3)) / 100).toFixed(4));

          // standarisasi: more approved POAs have more SUDAH
          const standarPool  = mi < 10
            ? ["SUDAH_STANDARISASI", "SUDAH_STANDARISASI", "PROSES_PENGAJUAN"]
            : mi < 13
            ? ["SUDAH_STANDARISASI", "PROSES_PENGAJUAN", "BELUM_STANDARISASI"]
            : STANDAR_STATUS;
          const standar = standarPool[(seed + oi + di + pi) % standarPool.length];

          lineItemsData.push({
            id: randomUUID(),
            poaId,
            kodeRequest: null,
            kodeCust: null,
            namaCust,
            role,
            spesialisasi,
            historisPSSP: null,
            kodePI,
            namaOutlet: outlet.namaOutlet,
            kodeProduk: prod.kodeProduk,
            namaProduk: prod.namaProduk,
            kategoriProdukFokus: "ETHICAL",
            itemKode: prod.kodeProduk,
            satuanTerkecil: "—",
            hargaSatuanTerkecil: dec(prod.hna),
            lamaPeriode: lama,
            periodeAwal: PERIOD,
            rencanaTotalBiaya: dec(totalBiaya),
            rencanaVisitMinggu: visitMinggu,
            hariKerjaBulan: hariKerja,
            jumlahResepHari: resep,
            qtyProdukResep: qty,
            statusStandarisasi: standar,
            persenPsspDokter: dec(psspDokter),
            persenPsspKpdm: dec(0),
            persenDiskon: dec(diskon),
            persenDp: dec(0),
            persenListingFee: dec(0),
            persenEntertain: dec(entertain),
            createdAt: new Date("2026-07-01T08:00:00Z"),
            updatedAt: new Date("2026-07-01T08:00:00Z"),
          });
        }
      }
    }

    const TRANSITIONS = [
      { action: "SUBMIT",  from: "DRAFT",            to: "SUBMITTED_TO_ASM",  actor: mr.nip,    at: "2026-07-02T09:00:00Z" },
      ...(!["SUBMITTED_TO_ASM"].includes(status) ? [
        { action: "APPROVE", from: "SUBMITTED_TO_ASM", to: "SUBMITTED_TO_SM",  actor: mr.asmNip, at: "2026-07-03T10:00:00Z" },
      ] : []),
      ...(["SUBMITTED_TO_NSM","APPROVED_BY_NSM"].includes(status) ? [
        { action: "APPROVE", from: "SUBMITTED_TO_SM",  to: "SUBMITTED_TO_NSM", actor: mr.smNip,  at: "2026-07-05T11:00:00Z" },
      ] : []),
      ...(status === "APPROVED_BY_NSM" ? [
        { action: "APPROVE", from: "SUBMITTED_TO_NSM", to: "APPROVED_BY_NSM",  actor: NSM_NIP,   at: "2026-07-08T14:00:00Z" },
      ] : []),
    ];

    await prisma.poaForm.create({
      data: {
        id: poaId,
        period: PERIOD,
        ownerId: mr.nip,
        currentHolderId: holderId,
        status,
        target: null,
        createdAt: new Date("2026-07-01T08:00:00Z"),
        updatedAt: new Date("2026-07-08T14:00:00Z"),
      },
    });

    if (lineItemsData.length > 0) {
      await prisma.poaLineItem.createMany({ data: lineItemsData });
    }

    for (const t of TRANSITIONS) {
      await prisma.poaAuditLog.create({
        data: {
          id: randomUUID(),
          poaId,
          actorId: t.actor,
          action: t.action,
          fromStatus: t.from,
          toStatus: t.to,
          snapshot: {},
          createdAt: new Date(t.at),
        },
      });
    }

    console.log(`  ✓ ${mr.name} (${status}) — ${lineItemsData.length} items`);
    totalForms++;
    totalItems += lineItemsData.length;
  }

  console.log(`\nSelesai: ${totalForms} POA, ${totalItems} line items`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
