"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const POPOVER_WIDTH = 224; // px — matches Tailwind's w-56

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
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Flip above the icon when there isn't enough room below — needed because
  // popover height varies with the description's length, so a fixed
  // "always below" offset ran off the bottom of the viewport for longer text
  // or headers near the fold (2026-07-30: "kalau textnya overflow ga bagus").
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popoverRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const popoverHeight = popoverRef.current.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
    const fitsBelow = r.bottom + 4 + popoverHeight <= window.innerHeight - 8;
    const top = fitsBelow ? r.bottom + 4 : Math.max(8, r.top - 4 - popoverHeight);
    setPos({ top, left });
  }, [open]);

  function showPopover() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPos({ top: r.bottom + 4, left });
    }
    setOpen(true);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open) showPopover();
    else setOpen(false);
  }

  return (
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={showPopover}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Info"
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none normal-case cursor-pointer"
        style={{ color: "var(--color-text-faint)", border: "1px solid var(--color-text-faint)" }}
      >
        i
      </button>
      {open && pos && (
        <div
          ref={popoverRef}
          role="tooltip"
          className="fixed z-50 w-56 whitespace-normal break-words rounded-md p-2.5 text-[11px] font-normal normal-case leading-snug shadow-lg"
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
