"""
Generate src/lib/bankSpesialisData.ts dari sheet "Bank Spesialis" di
internal/data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx (file 36MB; exceljs OOM,
pakai openpyxl read_only). docs/poa-bank-spesialis/.

Pakai:  python -I scripts/generateBankSpesialisData.py <bank.json> <master.json>
  bank.json   : dump sheet [{spesialis, kode, nama, ket}] (kolom A-D baris 4+)
  master.json : [{kodeProduk, namaProduk}] dari tabel Product untuk kode-kode di bank.json
Nama produk di Excel bisa beda ejaan dengan Product.namaProduk, jadi key lookup memuat KEDUANYA.
"""
import json, sys, collections
bank = json.load(open(sys.argv[1], encoding="utf-8"))
master = {m["kodeProduk"]: m["namaProduk"] for m in json.load(open(sys.argv[2], encoding="utf-8"))}

names = sorted({b["spesialis"] for b in bank})
by_kode = collections.defaultdict(list)
by_nama = collections.defaultdict(set)
ket = {}
for b in bank:
    if b["spesialis"] not in by_kode[b["kode"]]:
        by_kode[b["kode"]].append(b["spesialis"])
    for n in {b["nama"], master.get(b["kode"], "")}:
        if n:
            by_nama[n.strip().upper()].add(b["spesialis"])
    if b["ket"]:
        ket[b["spesialis"] + "|" + b["kode"]] = b["ket"]

def j(x): return json.dumps(x, ensure_ascii=False)
out = []
out.append("// GENERATED oleh scripts/generateBankSpesialisData.py dari sheet \"Bank Spesialis\" — jangan edit tangan.\n")
out.append("// Sumber: internal/data Rekomendasi dokter Per Hospital dan per Spesialist.xlsx. docs/poa-bank-spesialis/\n\n")
out.append("export const BANK_SPESIALIS_NAMES: string[] = " + j(names) + ";\n\n")
out.append("/** kodeProduk → nama spesialis (kanonik) yang direkomendasikan untuk produk itu. */\n")
out.append("export const BANK_SPESIALIS_BY_KODE: Record<string, string[]> = {\n")
for k in sorted(by_kode): out.append("  " + j(k) + ": " + j(by_kode[k]) + ",\n")
out.append("};\n\n")
out.append("/** namaProduk (UPPERCASE; ejaan Excel + Product.namaProduk) → nama spesialis. Penentu Produk Kontes. */\n")
out.append("export const BANK_SPESIALIS_BY_NAMA_PRODUK: Record<string, string[]> = {\n")
for n in sorted(by_nama): out.append("  " + j(n) + ": " + j(sorted(by_nama[n])) + ",\n")
out.append("};\n\n")
out.append("/** \"SPESIALIS|kodeProduk\" → Keterangan (alasan relevansi) bila diisi di sheet. */\n")
out.append("export const BANK_KETERANGAN: Record<string, string> = {\n")
for k in sorted(ket): out.append("  " + j(k) + ": " + j(ket[k]) + ",\n")
out.append("};\n")
open("src/lib/bankSpesialisData.ts", "w", encoding="utf-8", newline="\n").write("".join(out))
print("spesialis", len(names), "kode", len(by_kode), "nama", len(by_nama), "keterangan", len(ket))
