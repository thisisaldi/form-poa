"use client";

import React from "react";

export function BlastInBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center shrink-0 uppercase tracking-wide ${className}`}
      style={{
        background: "#f3e8ff",
        color: "#6b21a8",
        lineHeight: 1.2,
      }}
    >
      BLAST-IN
    </span>
  );
}

export function InsScBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center shrink-0 uppercase tracking-wide ${className}`}
      style={{
        background: "#e0e7ff",
        color: "#3730a3",
        lineHeight: 1.2,
      }}
    >
      INS - SC
    </span>
  );
}
