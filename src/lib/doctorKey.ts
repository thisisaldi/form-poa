/**
 * Kunci dokter di UI (satu kartu/baris per dokter per gelombang) — docs/poa-deal-addendum/.
 * Gelombang 1 tetap `${kodePI}|${namaCust}` persis seperti sebelum fitur gelombang, supaya semua kunci
 * lama (props, state) tidak berubah; gelombang >= 2 menambah `|${batch}`. Pure helper, aman diimpor client.
 */
export function doctorKeyOf(kodePI: string | null | undefined, namaCust: string, batch: number | null | undefined = 1): string {
  const b = batch ?? 1;
  return b > 1 ? `${kodePI ?? ""}|${namaCust}|${b}` : `${kodePI ?? ""}|${namaCust}`;
}
