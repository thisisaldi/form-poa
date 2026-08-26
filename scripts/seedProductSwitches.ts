import ExcelJS from "exceljs";
import path from "path";
import { prisma } from "../src/lib/prisma";

async function seedProductSwitches() {
  console.log("Reading excel file: hasil_terakhir.xlsx...");
  const wb = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), "hasil_terakhir.xlsx");
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const rowsToInsert: {
    sourceProductName: string;
    sourceProCode: string;
    recommendedProductName: string;
    recommendedProCode: string;
  }[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const values = row.values as any[];
    // Column 1: History Produk (sourceProductName)
    // Column 2: Pro Code History (sourceProCode)
    // Column 3: Produk Rekomendasi (recommendedProductName)
    // Column 4: Procode (recommendedProCode)
    const sourceProductName = values[1] ? String(values[1]).trim() : "";
    const sourceProCode = values[2] ? String(values[2]).trim() : "";
    const recommendedProductName = values[3] ? String(values[3]).trim() : "";
    const recommendedProCode = values[4] ? String(values[4]).trim() : "";

    if (sourceProCode && recommendedProCode) {
      rowsToInsert.push({
        sourceProductName,
        sourceProCode,
        recommendedProductName,
        recommendedProCode,
      });
    }
  });

  console.log(`Found ${rowsToInsert.length} valid product switch records in Excel.`);

  // Clear previous records for clean sync
  await prisma.productSwitchMapping.deleteMany({});

  // Batch insert in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
    const chunk = rowsToInsert.slice(i, i + chunkSize);
    await prisma.productSwitchMapping.createMany({
      data: chunk,
    });
    console.log(`Inserted chunk ${Math.floor(i / chunkSize) + 1} (${chunk.length} records)`);
  }

  console.log("Product switch mappings seeding completed successfully!");
}

seedProductSwitches()
  .catch((err) => {
    console.error("Error seeding product switches:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
