import React, { useState } from "react";

export function InfoTooltip({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false);
  const sizeClasses = size === "xs" ? "w-3 h-3 text-[9px] leading-none" : "w-3.5 h-3.5 text-[10px]";

  return (
    <span className="relative inline-flex items-center ml-0.5 align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`inline-flex items-center justify-center rounded-full font-bold border transition-colors cursor-pointer ${sizeClasses}`}
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg)",
          color: "var(--color-text-muted)",
        }}
        aria-label="Informasi"
      >
        i
      </button>
      {open && (
        <span
          className="absolute right-0 top-full mt-1.5 z-50 w-64 max-w-[260px] p-2.5 rounded-lg shadow-2xl text-xs font-normal normal-case text-left bg-slate-900 text-slate-100 border border-slate-700 leading-relaxed animate-fade-in pointer-events-none whitespace-normal break-words"
        >
          {text}
        </span>
      )}
    </span>
  );
}
