/**
 * Generates the "MEMO GA HO – Dept. Sales Support" .docx for SP Non Sales
 * requests (docs/sp-non-sales-memo/01-business-rules.md §4 — transcribed
 * from a physical signed original the user photographed 2026-09-23).
 * Built with the `docx` library (pure JS, no binary template asset to
 * maintain) rather than docxtemplater — the layout is simple enough
 * (metadata block + one table) that hand-building it here is less overhead
 * than checking in and maintaining a .docx master file.
 */
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, HeadingLevel } from "docx";

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * "DSS / IX / POA001.26" (2026-09-23 user correction — was bare "189" seq,
 * now "POA" + 3-digit zero-padded). Counter resets per TAHUN (not per
 * bulan) — bulan romawi tracks the calendar month at generate time
 * independently of the counter, which just keeps incrementing across
 * months within the same year (matches the "POA001 → POA002" example with
 * no reset mentioned between them).
 */
export function formatMemoNomor(tanggal: Date, seq: number): string {
  const roman = ROMAN_MONTHS[tanggal.getMonth()];
  const yearShort = String(tanggal.getFullYear()).slice(2, 4);
  const seqPadded = String(seq).padStart(3, "0");
  return `DSS / ${roman} / POA${seqPadded}.${yearShort}`;
}

export interface SpNonSalesMemoProdukRow {
  ptNie: string;
  kodeProduk: string;
  namaProduk: string;
  qtyBox: string;
}

export interface SpNonSalesMemoData {
  nomor: string;
  kepada: string;
  tanggal: Date;
  alasan: string;
  namaOutlet: string;
  namaPengusul: string;
  produk: SpNonSalesMemoProdukRow[];
  signerHormatKami: string;
  signerMenyetujui: string;
}

const BORDER = { style: BorderStyle.SINGLE, size: 2, color: "000000" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function headerCell(text: string): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true })] })],
  });
}

function bodyCell(text: string, alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT): TableCell {
  return new TableCell({ borders: CELL_BORDERS, children: [new Paragraph({ alignment, children: [new TextRun(text)] })] });
}

function metaRow(label: string, value: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: `${label.padEnd(9, " ")}: `, bold: false }), new TextRun(value)] });
}

const TANGGAL_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export async function buildSpNonSalesMemoDocx(data: SpNonSalesMemoData): Promise<Buffer> {
  const tanggalLabel = `${data.tanggal.getDate().toString().padStart(2, "0")} ${TANGGAL_ID[data.tanggal.getMonth()]} ${data.tanggal.getFullYear()}`;

  const produkTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          headerCell("NO"), headerCell("PT NIE"), headerCell("KODE PRODUK"), headerCell("NAMA PRODUK"),
          headerCell("QTY (BOX)"), headerCell("NAMA PENGUSUL"), headerCell("NAMA OUTLET"),
        ],
      }),
      ...data.produk.map((p, i) => new TableRow({
        children: [
          bodyCell(String(i + 1), AlignmentType.CENTER),
          bodyCell(p.ptNie),
          bodyCell(p.kodeProduk, AlignmentType.CENTER),
          bodyCell(p.namaProduk),
          bodyCell(p.qtyBox, AlignmentType.CENTER),
          bodyCell(data.namaPengusul),
          bodyCell(data.namaOutlet),
        ],
      })),
    ],
  });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, children: [new TextRun("MEMO")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("GA HO – Dept. Sales Support")] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(data.nomor)] }),
        new Paragraph({ text: "" }),
        metaRow("Kepada", data.kepada),
        metaRow("Dari", "Dept. Sales Support"),
        metaRow("Perihal", "Permintaan Produk SP Non Sales"),
        metaRow("Tanggal", tanggalLabel),
        new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } } }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun("Dengan hormat,")] }),
        new Paragraph({
          children: [new TextRun(
            `\tSehubungan dengan kebutuhan untuk ${data.alasan}, maka bersama dengan ini kami mengajukan permintaan produk SP Non Sales dengan rincian sebagai berikut:`
          )],
        }),
        new Paragraph({ text: "" }),
        produkTable,
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun("Demikian informasi ini kami sampaikan. Atas bantuan dan kerjasamanya kami ucapkan terima kasih.")] }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "" }),
        new Paragraph({
          tabStops: [{ type: "left", position: 5000 }],
          children: [new TextRun("Hormat kami,\tMenyetujui,")],
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "" }),
        new Paragraph({
          tabStops: [{ type: "left", position: 5000 }],
          children: [new TextRun(`(${data.signerHormatKami || "-"})\t(${data.signerMenyetujui || "-"})`)],
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: "Note : No SP memo ini diisi manual oleh Sales Support.", italics: true })] }),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}
