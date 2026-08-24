/**
 * One-time setup: run `npx tsx scripts/sippCreateVendor.ts <SIPP_BASE_URL> <VendorCode>`
 * to register this app as a SIPP vendor and print the ClientID/ClientSecret
 * to put in SIPP_CLIENT_ID/SIPP_CLIENT_SECRET (see .env.example). ClientSecret
 * is shown once — save it immediately.
 */

const [baseUrl, vendorCode] = process.argv.slice(2);
if (!baseUrl || !vendorCode) {
  console.error("Usage: npx tsx scripts/sippCreateVendor.ts <SIPP_BASE_URL> <VendorCode>");
  process.exit(1);
}

fetch(`${baseUrl}/hr/auth?insert=vendor`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ VendorCode: vendorCode }),
})
  .then((res) => res.json())
  .then((body) => {
    if (body.error?.status) {
      console.error("Create Vendor failed:", body.error.msg);
      process.exit(1);
    }
    console.log("SIPP_CLIENT_ID=" + body.data.ClientID);
    console.log("SIPP_CLIENT_SECRET=" + body.data.ClientSecret);
  })
  .catch((err) => {
    console.error("Request failed:", err);
    process.exit(1);
  });
