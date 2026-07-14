"""
Import PSSP Pelunasan Excel into PsspKontrak table.

Usage:
    python scripts/importPsspKontrak.py "excel/20260630_PSSP Pelunasan_Biaya Murni dan Pelunasan_Value.xlsx"

Requires: pip install pandas openpyxl psycopg2-binary python-dotenv
"""
import sys, re, json, os, pathlib
from datetime import date, datetime

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = pathlib.Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import psycopg2
import psycopg2.extras
import pandas as pd

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    sys.exit("DATABASE_URL not set in .env")

# Parse postgres URL: postgresql://user:pass@host:port/db
# Also handle ?... query params
import re as _re
_m = _re.match(r"postgresql(?:\+[^:]+)?://([^:]+):([^@]+)@([^:/]+):?(\d*)/([^?]+)", DATABASE_URL)
if not _m:
    sys.exit(f"Cannot parse DATABASE_URL: {DATABASE_URL}")
_user, _pass, _host, _port, _db = _m.groups()
_port = int(_port) if _port else 5432

EXCEL_PATH = sys.argv[1] if len(sys.argv) > 1 else "excel/20260630_PSSP Pelunasan_Biaya Murni dan Pelunasan_Value.xlsx"

# Extract snapshot date from filename (YYYYMMDD prefix)
_date_match = re.search(r"(\d{8})", pathlib.Path(EXCEL_PATH).name)
SNAPSHOT_DATE = date(int(_date_match.group()[:4]), int(_date_match.group()[4:6]), int(_date_match.group()[6:8])) if _date_match else None

print(f"Reading {EXCEL_PATH} (snapshot {SNAPSHOT_DATE})...")
df = pd.read_excel(
    EXCEL_PATH, sheet_name="PSSP",
    dtype={"KD_PRODUK": str, "KD_OUTLET": str, "KD_CUST": str, "C_URUT": str, "KD_SPC": str},
)
print(f"  {len(df)} rows loaded")
before = len(df)
df = df[df["C_URUT"].notna() & (df["C_URUT"].astype(str).str.strip() != "")]
print(f"  {len(df)} rows with valid C_URUT (skipped {before - len(df)} null)")

# ── Column helpers ──────────────────────────────────────────────────────────────
def period_cols(prefix):
    return sorted([c for c in df.columns if re.match(rf"^{prefix}_\d{{6}}$", c)])

EST_COLS  = period_cols("Est")
BM_COLS   = period_cols("BM")
LUN_COLS  = period_cols("Lunas")

def to_jsonb(row, cols):
    return {c.split("_", 1)[1]: float(row[c]) if pd.notna(row[c]) else 0.0 for c in cols if c in df.columns}

def flt(v, default=0.0):
    try:
        f = float(v)
        return f if not pd.isna(f) else default
    except Exception:
        return default

def txt(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return str(v).strip() or None

# ── Build rows ─────────────────────────────────────────────────────────────────
rows = []
for _, r in df.iterrows():
    est_map  = to_jsonb(r, EST_COLS)
    bm_map   = to_jsonb(r, BM_COLS)
    lun_map  = to_jsonb(r, LUN_COLS)
    rows.append((
        txt(r["KD_CUST"]),          # kd_cust
        txt(r["NM_CUST"]),          # nm_cust
        txt(r["C_URUT"]),           # c_urut
        txt(r.get("KD_SPC")),       # kd_spc
        txt(r.get("NM_SPC")),       # nm_spc
        txt(r.get("ROLE")),         # role
        int(flt(r.get("N_DIVISI", 0))) if r.get("N_DIVISI") else None,  # n_divisi
        txt(r.get("DIV_KODE")),     # div_kode
        flt(r.get("Biaya", 0)),     # biaya
        txt(r.get("PRD_AWAL")),     # prd_awal
        txt(r.get("PRD_AKHIR")),    # prd_akhir
        txt(r.get("NIP_USUL")),     # nip_usul
        txt(r.get("NM_USUL")),      # nm_usul
        txt(r.get("KD_OUTLET")),    # kd_outlet
        txt(r.get("NM_OUTLET")),    # nm_outlet
        txt(r.get("DIV_PROD")),     # div_prod
        txt(r.get("KD_PRODUK")),    # kd_produk
        txt(r.get("NM_PRODUK")),    # nm_produk
        flt(r.get("EstBaris")),     # est_baris
        flt(r.get("BM_BARIS")),     # bm_baris
        sum(est_map.values()),      # total_est
        sum(bm_map.values()),       # total_bm
        sum(lun_map.values()),      # total_lunas
        json.dumps(est_map),        # est_by_period
        json.dumps(bm_map),         # bm_by_period
        json.dumps(lun_map),        # lunas_by_period
        SNAPSHOT_DATE,              # snapshot_date
    ))

# ── Upsert ─────────────────────────────────────────────────────────────────────
UPSERT = """
INSERT INTO "PsspKontrak" (
  id, "kdCust", "nmCust", "cUrut", "kdSpc", "nmSpc", role, "nDivisi", "divKode",
  biaya, "prdAwal", "prdAkhir", "nipUsul", "nmUsul", "kdOutlet", "nmOutlet",
  "divProd", "kdProduk", "nmProduk",
  "estBaris", "bmBaris", "totalEst", "totalBm", "totalLunas",
  "estByPeriod", "bmByPeriod", "lunasByPeriod",
  "snapshotDate", "importedAt"
) VALUES (
  gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s,
  %s, %s, %s, %s, %s, %s, %s,
  %s, %s, %s,
  %s, %s, %s, %s, %s,
  %s::jsonb, %s::jsonb, %s::jsonb,
  %s, NOW()
)
ON CONFLICT ("cUrut", "kdProduk") DO UPDATE SET
  "kdCust"        = EXCLUDED."kdCust",
  "nmCust"        = EXCLUDED."nmCust",
  "kdSpc"         = EXCLUDED."kdSpc",
  "nmSpc"         = EXCLUDED."nmSpc",
  role            = EXCLUDED.role,
  "nDivisi"       = EXCLUDED."nDivisi",
  "divKode"       = EXCLUDED."divKode",
  biaya           = EXCLUDED.biaya,
  "prdAwal"       = EXCLUDED."prdAwal",
  "prdAkhir"      = EXCLUDED."prdAkhir",
  "nipUsul"       = EXCLUDED."nipUsul",
  "nmUsul"        = EXCLUDED."nmUsul",
  "kdOutlet"      = EXCLUDED."kdOutlet",
  "nmOutlet"      = EXCLUDED."nmOutlet",
  "divProd"       = EXCLUDED."divProd",
  "nmProduk"      = EXCLUDED."nmProduk",
  "estBaris"      = EXCLUDED."estBaris",
  "bmBaris"       = EXCLUDED."bmBaris",
  "totalEst"      = EXCLUDED."totalEst",
  "totalBm"       = EXCLUDED."totalBm",
  "totalLunas"    = EXCLUDED."totalLunas",
  "estByPeriod"   = EXCLUDED."estByPeriod",
  "bmByPeriod"    = EXCLUDED."bmByPeriod",
  "lunasByPeriod" = EXCLUDED."lunasByPeriod",
  "snapshotDate"  = EXCLUDED."snapshotDate",
  "importedAt"    = NOW()
"""

BATCH = 500
conn = psycopg2.connect(host=_host, port=_port, dbname=_db, user=_user, password=_pass)
conn.autocommit = False
cur = conn.cursor()

total = len(rows)
done  = 0
for i in range(0, total, BATCH):
    batch = rows[i:i+BATCH]
    psycopg2.extras.execute_batch(cur, UPSERT, batch, page_size=BATCH)
    done += len(batch)
    print(f"  {done}/{total} rows...", end="\r")

conn.commit()
cur.close()
conn.close()
print(f"\nDone. {total} rows upserted into PsspKontrak.")
