"use client";

import { useState, useRef, useEffect, useId, useCallback, useMemo } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  /** Group label — when it changes between consecutive options a non-interactive header row is inserted. */
  group?: string;
  /** Highlight this option with primary color + star badge (tier-0 focus products). */
  accent?: boolean;
  /** Short badge shown inline next to the label (e.g. group RS name). */
  tag?: string;
  /** Badge color variant — defaults to blue. */
  tagColor?: "blue" | "yellow" | "red";
}

const TAG_COLORS = {
  blue: { bg: "var(--color-blue-light)", fg: "var(--color-blue)" },
  yellow: { bg: "var(--color-warning-bg)", fg: "var(--color-warning)" },
  red: { bg: "var(--color-red-light)", fg: "var(--color-red)" },
} as const;

interface Props {
  name: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  emptyMessage?: string;
  /** Cap on rendered options before showing "+N lainnya" (default 80). Pass Infinity to show all. */
  maxVisible?: number;
}

export function Combobox({
  name,
  options,
  value,
  onChange,
  placeholder = "Ketik untuk mencari…",
  disabled = false,
  required = false,
  emptyMessage = "Tidak ada pilihan.",
  maxVisible = 80,
}: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  // When closed, display shows the selected label; when open, shows the typed query
  const displayValue = open ? query : (selected?.label ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false) ||
        (o.tag?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  // Visible slice — capped to avoid rendering hundreds of DOM nodes (override via maxVisible)
  const visibleOptions = filtered.length > maxVisible ? filtered.slice(0, maxVisible) : filtered;
  const hiddenCount = filtered.length - visibleOptions.length;

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector(`[data-option-idx="${highlighted}"]`) as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const select = useCallback(
    (option: ComboboxOption) => {
      onChange(option.value);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onChange]
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setHighlighted(0);
    if (!open) setOpen(true);
    if (e.target.value === "") onChange("");
  }

  function handleInputFocus() {
    setOpen(true);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlighted]) select(filtered[highlighted]);
        break;
      case "Escape":
        setOpen(false);
        setQuery("");
        break;
      case "Tab":
        setOpen(false);
        setQuery("");
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={value} required={required} />

      {/* Visible search input */}
      <div
        className="flex items-center input-field gap-2 cursor-text"
        style={{ padding: 0 }}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm px-3 py-2"
          style={{ color: "var(--color-text)" }}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
        />
        {/* Chevron icon */}
        <span
          className="pr-2.5 text-xs shrink-0 transition-transform duration-150"
          style={{
            color: "var(--color-text-faint)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          aria-hidden
        >
          ▾
        </span>
      </div>

      {/* Dropdown list */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 w-full mt-1 rounded-md border shadow-lg overflow-auto"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
            maxHeight: "14rem",
          }}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm" style={{ color: "var(--color-text-faint)" }}>
              {emptyMessage}
            </li>
          ) : (
            <>
              {(() => {
                let lastGroup: string | undefined = undefined;
                return visibleOptions.map((option, i) => {
                  const isHighlighted = i === highlighted;
                  const isSelected = option.value === value;
                  const showGroupHeader = option.group !== undefined && option.group !== lastGroup;
                  if (showGroupHeader) lastGroup = option.group;
                  return (
                    <>
                      {showGroupHeader && (
                        <li
                          key={`grp-${option.group}`}
                          aria-hidden
                          className="sticky top-0 z-10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide select-none"
                          style={{
                            color: "var(--color-text-muted)",
                            background: "var(--color-bg-subtle)",
                            borderTop: i > 0 ? "1px solid var(--color-border)" : undefined,
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          {option.group}
                        </li>
                      )}
                      <li
                        key={option.value}
                        data-option-idx={i}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => select(option)}
                        onMouseEnter={() => setHighlighted(i)}
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                        style={{
                          background: isHighlighted
                            ? "var(--color-blue)"
                            : isSelected
                            ? "var(--color-blue-light)"
                            : option.accent
                            ? "var(--color-blue-faint, rgba(59,130,246,0.06))"
                            : "transparent",
                          color: isHighlighted ? "#fff" : "var(--color-text)",
                        }}
                      >
                        {option.accent && !isHighlighted && (
                          <span className="text-xs shrink-0" style={{ color: "var(--color-blue)" }}>★</span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="text-sm font-medium truncate"
                              style={{ color: isHighlighted ? "#fff" : option.accent ? "var(--color-blue)" : "var(--color-text)" }}
                            >
                              {option.label}
                            </span>
                            {option.tag && (
                              <span
                                className="shrink-0 text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{
                                  background: isHighlighted ? "rgba(255,255,255,0.2)" : TAG_COLORS[option.tagColor ?? "blue"].bg,
                                  color: isHighlighted ? "#fff" : TAG_COLORS[option.tagColor ?? "blue"].fg,
                                }}
                              >
                                {option.tag}
                              </span>
                            )}
                          </span>
                          {option.sublabel && (
                            <span
                              className="block text-xs truncate"
                              style={{ color: isHighlighted ? "rgba(255,255,255,0.8)" : "var(--color-text-muted)" }}
                            >
                              {option.sublabel}
                            </span>
                          )}
                        </span>
                        {isSelected && (
                          <span
                            className="text-xs shrink-0"
                            style={{ color: isHighlighted ? "#fff" : "var(--color-blue)" }}
                          >
                            ✓
                          </span>
                        )}
                      </li>
                    </>
                  );
                });
              })()}
              {hiddenCount > 0 && (
                <li className="px-3 py-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
                  +{hiddenCount} lainnya — ketik lebih spesifik untuk mempersempit
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
