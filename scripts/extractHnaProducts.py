"""
Decrypts TKT...LAPORAN HNA SARUASUBUR.xlsx and exports all rows with a valid
Procod (DB kodeProduk) to scripts/hna-products.json for import into the Product table.
"""
import json, io, sys, pathlib, msoffcrypto, openpyxl

ROOT   = pathlib.Path(__file__).parent.parent
EXCEL  = ROOT / "excel" / "TKT202607020007 - LAPORAN HNA SARUASUBUR.xlsx"
OUTPUT = ROOT / "scripts" / "hna-products.json"
PASS   = "reporting1122"

print(f"Reading {EXCEL.name}…")
with open(EXCEL, "rb") as f:
    of = msoffcrypto.OfficeFile(f)
    of.load_key(password=PASS)
    buf = io.BytesIO()
    of.decrypt(buf)

wb = openpyxl.load_workbook(buf, data_only=True)
ws = wb.worksheets[0]   # Sheet1

# Row 8 = header; data starts row 9
# Cols (1-based): 1=No 3=KdItem 4=NamaItem 5=Status 6=Procod 7=Prodes 8=Procon 9=Principal 10=DivisiBrand 11=GroupBrand 12=HNA 15=Sellpack

products = []
seen = set()
for row in ws.iter_rows(min_row=9, values_only=True):
    no = row[0]
    if not no:
        break                       # end of data
    procod    = str(row[5]).strip() if row[5] and str(row[5]).strip() not in ("", "NULL") else None
    prodes    = str(row[6]).strip() if row[6] and str(row[6]).strip() not in ("", "NULL") else None
    group     = str(row[10]).strip() if row[10] and str(row[10]).strip() not in ("", "NULL") else ""
    hna       = float(row[11]) if row[11] is not None else 0.0
    sellpack  = str(row[14]).strip() if row[14] and str(row[14]).strip() not in ("", "NULL") else ""

    if not procod or not prodes:
        continue
    if procod in seen:
        continue
    seen.add(procod)

    products.append({
        "kodeProduk":    procod,
        "namaProduk":    prodes,
        "namaGroupBrand": group,
        "hna":           hna,
        "satuan":        sellpack,
        "zatAktif":      None,
    })

products.sort(key=lambda p: p["namaProduk"])
OUTPUT.write_text(json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"OK: Exported {len(products)} products to {OUTPUT.name}")
