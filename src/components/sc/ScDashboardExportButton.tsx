"use client";

import { useState, useRef, useEffect } from "react";

interface ScDashboardExportButtonProps {
  currentQuarter: string;
}

export function ScDashboardExportButton({ currentQuarter }: ScDashboardExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer"
        style={{
          backgroundColor: "var(--color-bg, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          color: "var(--color-text, #1e293b)",
        }}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>↓ Export Excel</span>
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-72 origin-top-right rounded-lg shadow-lg ring-1 ring-black/5 focus:outline-none transition-all py-1.5"
          style={{
            backgroundColor: "var(--color-bg, #ffffff)",
            border: "1px solid var(--color-border, #e2e8f0)",
          }}
          role="menu"
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--color-text-faint, #94a3b8)", borderColor: "var(--color-border-subtle, #f1f5f9)" }}>
            Pilihan Ekspor Excel
          </div>

          <a
            href={`/api/sc/export?period=${encodeURIComponent(currentQuarter)}`}
            onClick={() => setIsOpen(false)}
            className="group flex flex-col px-3 py-2.5 hover:bg-[var(--color-bg-subtle,#f8fafc)] transition-colors no-underline hover:no-underline"
            style={{ textDecoration: "none" }}
            role="menuitem"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold no-underline" style={{ color: "var(--color-text, #1e293b)", textDecoration: "none" }}>
                Kuartal Ini ({currentQuarter})
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-[var(--color-blue-light,#eff6ff)] text-[var(--color-blue,#2563eb)] no-underline">
                Kuartal Aktif
              </span>
            </div>
            <span className="text-xs mt-0.5 no-underline" style={{ color: "var(--color-text-muted, #64748b)", textDecoration: "none" }}>
              Unduh data POA SC & produk untuk kuartal {currentQuarter}
            </span>
          </a>

          <a
            href="/api/sc/export?period=all"
            onClick={() => setIsOpen(false)}
            className="group flex flex-col px-3 py-2.5 hover:bg-[var(--color-bg-subtle,#f8fafc)] transition-colors border-t no-underline hover:no-underline"
            style={{ borderColor: "var(--color-border-subtle, #f1f5f9)", textDecoration: "none" }}
            role="menuitem"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold no-underline" style={{ color: "var(--color-text, #1e293b)", textDecoration: "none" }}>
                Semua Produk & Periode
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700 no-underline">
                Lengkap
              </span>
            </div>
            <span className="text-xs mt-0.5 no-underline" style={{ color: "var(--color-text-muted, #64748b)", textDecoration: "none" }}>
              Unduh rekap semua produk dari seluruh periode POA SC
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
