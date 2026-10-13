/**
 * Waktu untuk UI dalam WIB (Asia/Jakarta) dengan keterangan "WIB". Pod server berjalan di UTC dan
 * toLocaleString tanpa timeZone memakai zona proses/browser, jadi jam di riwayat aktivitas mundur 7 jam
 * (2026-10-13). Aman di server maupun client.
 */
const WIB = "Asia/Jakarta";

/** "13/10/2026, 10.31.05 WIB" */
export function formatWib(value: Date | string | number): string {
  return `${new Date(value).toLocaleString("id-ID", { timeZone: WIB })} WIB`;
}

/** "13 Okt 2026, 10.31 WIB" (tanpa detik) */
export function formatWibShort(value: Date | string | number): string {
  return `${new Date(value).toLocaleString("id-ID", { timeZone: WIB, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} WIB`;
}
