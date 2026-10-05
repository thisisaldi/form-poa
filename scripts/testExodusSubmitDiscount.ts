/**
 * Test script — POST /promotion/v1/request/discount (Exodus).
 * Default DRY RUN: prints the payload-relevant data (outlet_id, product
 * principal/type from core/v1/products) without submitting. `--send` really
 * POSTs — WRITES a discount request in Exodus, so run with STAGING env only:
 *
 *   npx tsx --env-file=.env.staging scripts/testExodusSubmitDiscount.ts <outletCode> <productCode> [AMS|PPG|MPI] [DPF|DPL] [--send]
 *
 * division_distributor_code / distributor_product_code_prefix: sent as null
 * (per Exodus).
 */
import { env } from "../src/lib/env";
import { getExodusOutletIdByCode, getLiveProductPricing, submitDiscountRequest } from "../src/lib/exodusApi";
import { EXODUS_DISTRIBUTORS, type ExodusDistributorKode } from "../src/lib/exodusDistributors";

async function main() {
  const [outletCode, productCode, distArg = "AMS", tipeArg = "DPF"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const send = process.argv.includes("--send");
  if (!outletCode || !productCode) throw new Error("Usage: testExodusSubmitDiscount.ts <outletCode> <productCode> [AMS|PPG|MPI] [DPF|DPL] [--send]");
  const dist = EXODUS_DISTRIBUTORS[distArg as ExodusDistributorKode];
  if (!dist) throw new Error(`Distributor tidak dikenal: ${distArg}`);
  const tipe = tipeArg === "DPL" ? "DPL" : "DPF";

  console.log("EXODUS_API_BASE_URL =", env.EXODUS_API_BASE_URL);
  const outletId = await getExodusOutletIdByCode(outletCode);
  const pricing = (await getLiveProductPricing())?.get(productCode);
  console.log({ outletId, distributor: dist, pricing });
  if (!outletId || !pricing?.principalId || !pricing.principalCode || !pricing.principalName) throw new Error("outlet_id / principal produk tidak lengkap.");
  if (!send) return console.log("Dry run — add --send to POST.");

  const now = new Date();
  // DPL seperti data nyata: 1 bulan berjalan..akhir tahun, batas hari WIB (UTC+7). DPF: null.
  const dplStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 7 * 3600e3);
  const dplEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1) - 7 * 3600e3 - 1);
  const result = await submitDiscountRequest({
    discountType: tipe,
    outletId,
    outletCode,
    outletName: "TEST",
    distributorId: dist.id,
    distributorName: dist.name,
    requestDocNumber: tipe === "DPF" ? "TEST-PO-001" : null,
    requestDocDate: now.toISOString(),
    startDate: tipe === "DPL" ? dplStart.toISOString() : null,
    endDate: tipe === "DPL" ? dplEnd.toISOString() : null,
    note: "test dari Form POA",
    products: [{
      productName: pricing.namaProduk ?? "TEST",
      productCode,
      productType: pricing.namaGroupBrand === "ETHICAL" ? "ETH" : "OTC",
      principalDistributorId: pricing.principalId,
      principalDistributorName: pricing.principalName,
      principalDistributorCode: pricing.principalCode,
      principalPercentage: 1,
      distributorPercentage: 1,
      quantity: tipe === "DPF" ? 1 : 0,
    }],
    file: { name: "test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") },
  });
  console.log(JSON.stringify(result, null, 2));
}

main();
