import React, { useState } from "react";

export interface InfoTooltipProps {
  text?: React.ReactNode;
  content?: React.ReactNode;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  size?: "sm" | "xs";
  align?: "left" | "right" | "center";
}

export function InfoTooltip({
  text,
  content,
  children,
  trigger,
  size = "sm",
  align = "right",
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const sizeClasses = size === "xs" ? "w-3 h-3 text-[9px] leading-none" : "w-3.5 h-3.5 text-[10px]";

  const alignClasses =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : align === "left"
      ? "left-0"
      : "right-0";

  const tooltipBody = content ?? children ?? text;

  return (
    <span className="relative inline-flex items-center ml-0.5 align-middle">
      {trigger ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="cursor-pointer"
        >
          {trigger}
        </span>
      ) : (
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
      )}
      {open && tooltipBody && (
        <span
          className={`absolute ${alignClasses} top-full mt-1.5 z-50 w-64 max-w-[280px] p-2.5 rounded-lg shadow-2xl text-xs font-normal normal-case text-left bg-slate-900 text-slate-100 border border-slate-700 leading-relaxed animate-fade-in pointer-events-none whitespace-normal break-words`}
        >
          {tooltipBody}
        </span>
      )}
    </span>
  );
}
