import { CANVASSER_API_BASE_URL } from "@/lib/canvasserApi";

export async function getPrincodeProducts(): Promise<any[]> {
  try {
    const res1 = await fetch(`${CANVASSER_API_BASE_URL}/product/get-princode-products?page=1&limit=100`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res1.ok) {
      console.error(`Canvasser Princode Products API returned status ${res1.status}`);
      return [];
    }

    const data1 = await res1.json();
    const totalPages = data1.meta?.total_pages || 1;
    let allProducts = [...(data1.data || [])];

    if (totalPages > 1) {
      const promises = [];
      for (let p = 2; p <= totalPages; p++) {
        promises.push(
          fetch(`${CANVASSER_API_BASE_URL}/product/get-princode-products?page=${p}&limit=100`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            cache: "no-store",
          }).then((r) => (r.ok ? r.json() : null))
        );
      }

      const results = await Promise.all(promises);
      for (const r of results) {
        if (r && r.data) {
          allProducts = allProducts.concat(r.data);
        }
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Failed fetching princode products from Canvasser API:`, error);
    return [];
  }
}
