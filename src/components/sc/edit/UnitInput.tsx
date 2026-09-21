"use client";

import { formatRp } from "@/lib/utils";

interface UnitInputProps {
  value: string;
  onChange: (v: string) => void;
  unit?: string | null;
  placeholder?: string;
  /** When set, renders up/down stepper buttons that bump the value by this amount. */
  step?: number;
  min?: number;
  /** When set, typing/stepping past this value is clamped down to it (e.g. Hari Praktek ≤ 31, no month has more days). */
  max?: number;
  disabled?: boolean;
  className?: string;
  /** When true, only permits non-negative whole numbers (integers). Decimal points, commas, and negative signs are blocked. */
  integerOnly?: boolean;
}

export function UnitInput({
  value,
  onChange,
  unit,
  placeholder = "0",
  step,
  min = 0,
  max,
  disabled = false,
  className,
  integerOnly = false,
}: UnitInputProps) {
  const isCurrency = unit === "Rp";
  let normalizedValue = value ?? "";
  if (isCurrency) {
    normalizedValue = formatRp(value);
  } else if (integerOnly) {
    normalizedValue = normalizedValue ? normalizedValue.split(".")[0].replace(/\D/g, "").replace(/^0+(?=\d)/, "") : "";
  } else if (value) {
    normalizedValue = value.replace(/^0+(?=\d)/, "");
  }
  const displayValue = normalizedValue;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (integerOnly) {
      // Prevent decimal points, commas, negative/positive signs, and exponential notation
      if (['.', ',', '-', '+', 'e', 'E'].includes(e.key)) {
        e.preventDefault();
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    let v = e.target.value;
    if (isCurrency) {
      const clean = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      onChange(clean);
      return;
    }

    if (integerOnly) {
      const clean = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      if (max != null && clean !== "") {
        const n = parseInt(clean, 10);
        if (!isNaN(n) && n > max) {
          onChange(String(max));
          return;
        }
      }
      onChange(clean);
      return;
    }

    if (v === "") {
      onChange(v);
      return;
    }

    if (!/^\d*\.?\d*$/.test(v)) return;
    
    // Prevent dirty leading zeros like "02" -> "2", "00" -> "0"
    v = v.replace(/^0+(?=\d)/, "");

    // Clamp only once the value is a complete-enough number to compare
    if (max != null) {
      const n = parseFloat(v);
      if (!isNaN(n) && n > max) {
        onChange(String(max));
        return;
      }
    }
    onChange(v);
  }

  function bump(delta: number) {
    if (step == null) return;
    const current = parseFloat(value) || parseFloat(placeholder) || 0;
    let next = Math.max(min, current + delta);
    if (max != null) next = Math.min(max, next);
    if (integerOnly) {
      onChange(Math.round(next).toString());
    } else {
      const decimals = step % 1 === 0 ? 0 : String(step).split(".")[1]?.length ?? 1;
      onChange(next.toFixed(decimals));
    }
  }

  return (
    <div
      className={`flex items-stretch rounded-md overflow-hidden ${className ?? "h-[32px]"}`}
      style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}
    >
      <input
        type="text"
        inputMode={integerOnly ? "numeric" : "decimal"}
        placeholder={placeholder}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="flex-1 min-w-0 w-full px-1.5 text-[11px] outline-none disabled:opacity-75 disabled:cursor-not-allowed h-full"
        style={{ background: disabled ? "var(--color-bg-subtle)" : "transparent", color: "var(--color-text)" }}
      />
      {step != null && !disabled && (
        <div className="flex flex-col shrink-0" style={{ borderLeft: "1px solid var(--color-border-strong)" }}>
          <button
            type="button"
            onClick={() => bump(step)}
            tabIndex={-1}
            disabled={disabled}
            className="flex-1 flex items-center justify-center px-1.5 leading-none"
            style={{
              fontSize: 9,
              color: "var(--color-text-faint)",
              background: "var(--color-bg-subtle)",
              borderBottom: "1px solid var(--color-border-strong)",
            }}
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => bump(-step)}
            tabIndex={-1}
            disabled={disabled}
            className="flex-1 flex items-center justify-center px-1.5 leading-none"
            style={{ fontSize: 9, color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}
          >
            ▼
          </button>
        </div>
      )}
      {unit && (
        <>
          <span style={{ width: 1, background: "var(--color-border-strong)" }} />
          <span
            className="flex items-center px-1.5 text-[11px] font-medium whitespace-nowrap"
            style={{ color: "var(--color-text-faint)", background: "var(--color-bg-subtle)" }}
          >
            {unit}
          </span>
        </>
      )}
    </div>
  );
}
