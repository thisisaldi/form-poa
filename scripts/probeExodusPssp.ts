/**
 * Read-only probe: has Exodus /promotion/v1/pssp gained per-product + pelunasan
 * fields since 2026-09-02? Prints key sets only (no full dumps).
 *
 * Run: npx tsx scripts/probeExodusPssp.ts [customer_id]
 */
import { getAccessToken } from "../src/lib/exodusApi";

const base = process.env.EXODUS_API_BASE_URL;

async function get(token: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  console.log(`\n--- ${res.status} ${url.pathname}${url.search}`);
  return json ?? text.slice(0, 200);
}

const keys = (o: any) => (o && typeof o === "object" ? Object.keys(o) : typeof o);

async function main() {
  if (process.argv[2]==="2") return main2();
  const token = await getAccessToken();
  if (!token) return console.log("no token (env not configured?)");
  const customerId = process.argv[2];

  const list = await get(token, "/promotion/v1/pssp", { page: "1", limit: "3", ...(customerId ? { customer_id: customerId } : {}) });
  console.log("top keys:", keys(list), "data keys:", keys(list?.data));
  const rows = Array.isArray(list?.data) ? list.data : list?.data?.data ?? list?.data?.pssp ?? [];
  const first = rows[0];
  console.log("row keys:", keys(first));
  if (first) console.log(JSON.stringify(first, null, 1).slice(0, 2500));

  const id = first?.pssp_header_id;
  if (id) {
    for (const p of [`/promotion/v1/pssp/${id}`, `/promotion/v1/pssp/${id}/products`, `/promotion/v1/pssp/${id}/items`, `/promotion/v1/pssp/${id}/settlements`]) {
      const r = await get(token, p);
      console.log(JSON.stringify(r).slice(0, 400));
    }
  }
  for (const p of ["/promotion/v1/pssp/settlements", "/promotion/v1/pssp/products", "/promotion/v1/pssp/histories", "/promotion/v1/pssp/payments"]) {
    const r = await get(token, p, customerId ? { customer_id: customerId } : {});
    console.log(JSON.stringify(r).slice(0, 600));
  }
}

main();

async function main2() {
  const token = (await getAccessToken())!;
  const tries: [string, Record<string,string>][] = [
    ["/promotion/v1/pssp/products", { page: "1", limit: "3", pssp_id: "37176" }],
    ["/promotion/v1/pssp/products", { page: "1", limit: "3", id: "37176" }],
    ["/promotion/v1/pssp/products", { page: "1", limit: "3", pssp_header_id: "37176" }],
    ["/promotion/v1/pssp/products", { page: "1", limit: "3", customer_id: "19249" }],
    ["/promotion/v1/pssp", { page: "1", limit: "2", pssp_header_id: "37176" }],
  ];
  for (const [p, q] of tries) console.log(JSON.stringify(await get(token, p, q)).slice(0, 1500));
}
