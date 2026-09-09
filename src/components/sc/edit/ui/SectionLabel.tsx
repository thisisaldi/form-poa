import React from "react";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wider mb-2"
      style={{ color: "var(--color-text-faint)" }}
    >
      {children}
    </p>
  );
}
