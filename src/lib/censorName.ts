/**
 * Sensor nama dokter untuk tampilan/export: tiap kata hanya huruf depannya,
 * sisanya bintang dengan jumlah TETAP (4) supaya panjang nama asli tidak
 * kelihatan. "Lina Kartika" -> "L**** K****".
 */
export function censorName(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${[...w][0].toUpperCase()}****`)
    .join(" ");
}
