import type { ClassValue } from "clsx";
import { clsx } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatRp(val: string | number | null | undefined): string {
  if (val == null || val === "") return "";
  // Strip all non-digits if it is a string representation before parsing
  const cleanStr = typeof val === "number" ? val.toString() : val.toString().replace(/\./g, "");
  const n = parseFloat(cleanStr);
  if (isNaN(n)) return "";
  return Math.round(n).toLocaleString("id-ID");
}

export function parseRp(val: string): string {
  return val.replace(/\D/g, "");
}
