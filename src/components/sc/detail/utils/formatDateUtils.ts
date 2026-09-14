/**
 * Utility functions for formatting month and period strings in SC Detail.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
];

/**
 * Formats a 6-digit month string (e.g. "202604") into "Apr 2026".
 * Uses Intl.DateTimeFormat (id-ID locale) if valid.
 */
export function formatMonthLabel(m: string): string {
  if (!m || m.length !== 6) return m || "";
  const year = parseInt(m.slice(0, 4), 10);
  const monthIndex = parseInt(m.slice(4, 6), 10) - 1;
  if (isNaN(year) || isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return m;
  return new Date(year, monthIndex).toLocaleString("id-ID", { month: "short", year: "numeric" });
}

/**
 * Formats a 6-digit month key (e.g. "202604") into "Apr 2026" using Indonesian abbreviations.
 */
export function formatMonthKey(key: string): string {
  if (!key || key.length !== 6) return key || "";
  const year = key.slice(0, 4);
  const month = parseInt(key.slice(4, 6), 10);
  if (isNaN(month) || month < 1 || month > 12) return key;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Returns just the short month abbreviation (e.g. "Jul" from "202607").
 */
export function formatShortMonth(key: string): string {
  if (!key || key.length < 6) return key || "";
  const month = parseInt(key.slice(4, 6), 10);
  if (isNaN(month) || month < 1 || month > 12) return key;
  return MONTH_NAMES[month - 1];
}
