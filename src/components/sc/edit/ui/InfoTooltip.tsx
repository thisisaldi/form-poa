"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";

export interface InfoTooltipProps {
  text?: React.ReactNode;
  content?: React.ReactNode;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  size?: "sm" | "xs";
  align?: "left" | "right" | "center";
  width?: number;
  className?: string;
}

export function InfoTooltip({
  text,
  content,
  children,
  trigger,
  size = "sm",
  align = "right",
  width = 270,
  className = "",
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  const sizeClasses = size === "xs" ? "w-3 h-3 text-[9px] leading-none" : "w-3.5 h-3.5 text-[10px]";
  const tooltipBody = content ?? children ?? text;

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipWidth = width;
      const spaceBelow = window.innerHeight - rect.bottom;
      // If not enough room below (< 160px) and more room above, flip upwards
      const openUpwards = spaceBelow < 160 && rect.top > 160;

      let left = rect.left;
      if (align === "right") {
        left = rect.right - tooltipWidth;
      } else if (align === "center") {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
      }

      // Clamp horizontally within viewport
      left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12));

      setTooltipStyle({
        position: "fixed",
        top: openUpwards ? undefined : rect.bottom + 6,
        bottom: openUpwards ? window.innerHeight - rect.top + 6 : undefined,
        left,
        width: tooltipWidth,
        zIndex: 99999,
      });
    }
  }, [align, width]);

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [open, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex items-center align-middle ${trigger ? "" : "ml-0.5"} ${className}`}
    >
      {trigger ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          onMouseEnter={() => {
            updatePosition();
            setOpen(true);
          }}
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
          onMouseEnter={() => {
            updatePosition();
            setOpen(true);
          }}
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

      {open && tooltipBody && mounted && typeof document !== "undefined" &&
        createPortal(
          <div
            style={tooltipStyle}
            className="p-2.5 rounded-lg shadow-2xl text-xs font-normal normal-case text-left bg-slate-900 text-slate-100 border border-slate-700 leading-relaxed pointer-events-none whitespace-normal break-words animate-fade-in"
          >
            {tooltipBody}
          </div>,
          document.body
        )}
    </span>
  );
}
