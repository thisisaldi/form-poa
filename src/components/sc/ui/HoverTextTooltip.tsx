"use client";

import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";

export interface HoverTextTooltipProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * Reusable hover tooltip component in src/components/sc/ui:
 * - Truncates content with ellipsis.
 * - Displays an instant portal tooltip on hover in desktop view (>= 640px).
 * - Leaves mobile touch behavior clean and unobtrusive.
 */
export function HoverTextTooltip({
  text,
  className = "truncate block cursor-default",
  style,
  children,
}: HoverTextTooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 640 && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const tooltipWidth = Math.min(420, window.innerWidth - 32);
      let left = rect.left;
      if (left + tooltipWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - tooltipWidth - 16);
      }
      setCoords({
        top: rect.bottom + 4,
        left,
      });
      setShow(true);
    }
  };

  const handleMouseLeave = () => {
    setShow(false);
  };

  return (
    <>
      <span
        ref={ref}
        className={className}
        style={style}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children ?? text}
      </span>
      {show && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              maxWidth: "min(440px, 92vw)",
              zIndex: 999999,
            }}
            className="pointer-events-none p-2 rounded-lg shadow-2xl text-xs font-normal normal-case text-left bg-slate-900 text-slate-100 border border-slate-700 leading-snug whitespace-normal break-words animate-fade-in"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
