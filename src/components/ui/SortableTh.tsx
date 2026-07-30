"use client";

import { HeaderInfo } from "@/components/ui/HeaderInfo";

export type SortDir = "asc" | "desc";

/**
 * Clickable column header with up/down sort carets (2026-07-30 request:
 * "tombol sort by nya juga, dan bisa descending dan ascending dengan icon
 * atas/bawah") — shared by TerritoryTable (Summary) and SalesAchievementTable
 * (Monitoring) so both pages get the same sortable-header affordance. Both
 * carets are always visible; the active direction is highlighted in blue,
 * the inactive one stays faint — same "always-visible, active one lit up"
 * convention as the tab bar elsewhere in this app.
 */
export function SortableTh<K extends string>({
  label, sortKey, currentKey, currentDir, onSort, align = "right", sticky = false, title, info,
}: {
  label: string;
  sortKey: K;
  currentKey: K | null;
  currentDir: SortDir;
  onSort: (key: K) => void;
  align?: "left" | "right";
  /** Pins this header to the left edge, matching the table body's frozen first column. */
  sticky?: boolean;
  title?: string;
  /** Shown in a click-to-open popover via the header's "i" icon — what this column means. */
  info?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      title={title}
      className={`py-2 px-3 font-medium whitespace-nowrap select-none${sticky ? " sticky left-0 z-10" : ""}`}
      style={{
        color: active ? "var(--color-blue)" : "var(--color-text-faint)",
        textAlign: align,
        ...(sticky ? { background: "var(--color-surface)", borderRight: "1px solid var(--color-border)" } : {}),
      }}
    >
      <span className="inline-flex items-center gap-1" style={align === "right" ? { flexDirection: "row-reverse" } : undefined}>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 hover:opacity-75 transition-opacity cursor-pointer"
          style={align === "right" ? { flexDirection: "row-reverse" } : undefined}
          aria-label={`Urutkan berdasarkan ${label}`}
        >
          <span>{label}</span>
          <span className="inline-flex flex-col leading-none">
            <svg viewBox="0 0 10 6" className="h-[5px] w-2.5"
              style={{ fill: active && currentDir === "asc" ? "var(--color-blue)" : "var(--color-text-faint)", opacity: active && currentDir === "asc" ? 1 : 0.4 }}>
              <path d="M5 0L10 6H0L5 0Z" />
            </svg>
            <svg viewBox="0 0 10 6" className="h-[5px] w-2.5 mt-[2px]"
              style={{ fill: active && currentDir === "desc" ? "var(--color-blue)" : "var(--color-text-faint)", opacity: active && currentDir === "desc" ? 1 : 0.4 }}>
              <path d="M5 6L0 0H10L5 6Z" />
            </svg>
          </span>
        </button>
        {info && <HeaderInfo text={info} />}
      </span>
    </th>
  );
}

/** Generic comparator: numbers/strings, nulls always sort last regardless of direction. */
export function compareSortValues(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" || typeof b === "string") {
    const cmp = String(a).localeCompare(String(b));
    return dir === "asc" ? cmp : -cmp;
  }
  return dir === "asc" ? a - b : b - a;
}
