"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small "i" icon for table column headers — click to show what the column
 * means (2026-07-30 request: "di setiap header ada ikon i, kalau diklik ada
 * informasi kolom itu tentang apa"). Positioned with `fixed` (computed from
 * the button's own bounding rect) rather than an absolutely-positioned
 * sibling, so the popover isn't clipped by the table's `overflow-x-auto`
 * wrapper.
 */
export function HeaderInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const left = Math.min(r.left, window.innerWidth - 240);
      setPos({ top: r.bottom + 4, left: Math.max(8, left) });
    }
    setOpen((v) => !v);
  }

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Info kolom"
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none normal-case"
        style={{ color: "var(--color-text-faint)", border: "1px solid var(--color-text-faint)" }}
      >
        i
      </button>
      {open && pos && (
        <div
          role="tooltip"
          className="fixed z-50 w-56 rounded-md p-2.5 text-[11px] font-normal normal-case leading-snug shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
