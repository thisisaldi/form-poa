"use client";

import { Fragment, useState, useRef, useEffect, useLayoutEffect, useId, useCallback, useMemo } from "react";

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
  tagColor?: "blue" | "yellow" | "red" | "green" | "orange" | "lime" | "indigo" | "purple";
  /** Render `tag` as a plain color dot (title = tag text) instead of a text pill. */
  tagDotOnly?: boolean;
  /** Second, independent badge (e.g. PSSP history) — shown alongside `tag`, not instead of it. */
  tag2?: string;
  tag2Color?: "blue" | "yellow" | "red" | "green" | "orange" | "lime" | "indigo" | "purple" | "gray";
  /** Third, independent badge (e.g. "Retensi") — rendered solid/high-contrast rather
   * than as a pastel pill, so it stands out from tag/tag2 instead of blending in
   * (2026-07-27: previously baked into tag2's text, easy to miss). */
  tag3?: string;
  tag3Color?: "blue" | "yellow" | "red" | "green" | "orange" | "lime" | "indigo" | "purple" | "gray";
  tags?: {
    tag: string;
    color?: "blue" | "yellow" | "red" | "green" | "orange" | "lime" | "indigo" | "purple" | "gray";
  }[];
}

export const TAG_COLORS = {
  blue: { bg: "var(--color-blue-light)", fg: "var(--color-blue)" },
  yellow: { bg: "var(--color-warning-bg)", fg: "var(--color-warning)" },
  red: { bg: "var(--color-red-light)", fg: "var(--color-red)" },
  orange: { bg: "var(--color-orange-light, #ffedd5)", fg: "var(--color-orange, #ea580c)" },
  green: { bg: "var(--color-green-light, #dcfce7)", fg: "var(--color-success, #16a34a)" },
  lime: { bg: "#dcfce7", fg: "#166534" },
  indigo: { bg: "#e0e7ff", fg: "#3730a3" },
  purple: { bg: "#f3e8ff", fg: "#6b21a8" },
  gray: { bg: "#f3f4f6", fg: "#4b5563" },
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

  const effectiveMaxVisible = useMemo(() => {
    if (!value) return maxVisible;
    const idx = filtered.findIndex((o) => o.value === value);
    return idx >= 0 ? Math.max(maxVisible, idx + 20) : maxVisible;
  }, [value, filtered, maxVisible]);

  // Visible slice — capped to avoid rendering hundreds of DOM nodes (override via maxVisible)
  const visibleOptions = filtered.length > effectiveMaxVisible ? filtered.slice(0, effectiveMaxVisible) : filtered;
  const hiddenCount = filtered.length - visibleOptions.length;

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open) return;
    const rafId = requestAnimationFrame(() => {
      const item = listRef.current?.querySelector(`[data-option-idx="${highlighted}"]`) as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(rafId);
  }, [highlighted, open]);

  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updateMenuPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 640;

      let left = rect.left;
      let width: number | string | undefined = undefined;
      let minWidth: number | string;
      let maxWidth: number | string;

      if (isMobile) {
        const sideMargin = Math.min(Math.max(rect.left, 12), 32);
        left = sideMargin;
        const mobileWidth = Math.max(160, viewportWidth - sideMargin * 2);
        width = mobileWidth;
        minWidth = mobileWidth;
        maxWidth = mobileWidth;
      } else {
        // Desktop: sama persis seperti sebelum diubah
        left = rect.left;
        width = undefined;
        minWidth = Math.max(rect.width, 220);
        maxWidth = "min(28rem, 90vw)";
      }

      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left,
        width,
        minWidth,
        maxWidth,
        boxSizing: "border-box",
        zIndex: 9999,
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      updateMenuPosition();
      window.addEventListener("scroll", updateMenuPosition, true);
      window.addEventListener("resize", updateMenuPosition);
      return () => {
        window.removeEventListener("scroll", updateMenuPosition, true);
        window.removeEventListener("resize", updateMenuPosition);
      };
    }
  }, [open, updateMenuPosition]);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
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

  const openMenu = useCallback(() => {
    updateMenuPosition();
    const selectedIdx = options.findIndex((o) => o.value === value);
    setHighlighted(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
    setQuery("");
  }, [options, value, updateMenuPosition]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    updateMenuPosition();
    setQuery(e.target.value);
    setHighlighted(0);
    if (!open) setOpen(true);
    if (e.target.value === "") onChange("");
  }

  function handleInputFocus() {
    openMenu();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        openMenu();
      }
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
        onClick={() => {
          if (!open) openMenu();
          inputRef.current?.focus();
        }}
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
          className="flex-1 min-w-0 bg-transparent outline-none text-sm px-3 py-2"
          style={{ color: "var(--color-text)" }}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
        />
        {/* Chevron icon */}
        <span
          className="pr-2.5 text-xs shrink-0 transition-transform duration-150 cursor-pointer"
          style={{
            color: "var(--color-text-faint)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            if (open) {
              setOpen(false);
              setQuery("");
            } else {
              openMenu();
              inputRef.current?.focus();
            }
          }}
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
          className="w-max rounded-md border shadow-lg overflow-auto box-border"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
            maxHeight: "14rem",
            boxSizing: "border-box",
            ...menuStyle,
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
                    <Fragment key={option.value}>
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
                        className="flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors"
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
                          <span className="shrink-0 mt-0.5" style={{ color: "var(--color-blue)", fontSize: 15, fontWeight: 700 }}>★</span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-start gap-1.5 min-w-0 flex-wrap">
                            <span
                              className="text-sm font-medium whitespace-normal break-words leading-snug"
                              style={{ color: isHighlighted ? "#fff" : option.accent ? "var(--color-blue)" : "var(--color-text)" }}
                            >
                              {option.label}
                            </span>
                            {option.tags && option.tags.length > 0 ? (
                              option.tags.map((t, tIdx) => {
                                const isOnline = t.tag === "ONLINE";
                                const isBlastIn = t.tag === "BLAST-IN";
                                if (isOnline) {
                                  return (
                                    <span
                                      key={tIdx}
                                      className="shrink-0 px-1.5 py-0.5 rounded font-bold text-[10px]"
                                      style={{
                                        background: isHighlighted ? "#fff" : "#fde047",
                                        color: "#000",
                                        boxShadow: isHighlighted ? "none" : "0 1px 2px rgba(0,0,0,0.06)",
                                      }}
                                    >
                                      ONLINE
                                    </span>
                                  );
                                }
                                const col = (t.color && TAG_COLORS[t.color]) || TAG_COLORS.blue;
                                return (
                                  <span
                                    key={tIdx}
                                    className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${
                                      isBlastIn ? "text-[10px]" : "text-xs"
                                    }`}
                                    style={{
                                      background: isHighlighted ? "rgba(255,255,255,0.2)" : col.bg,
                                      color: isHighlighted ? "#fff" : col.fg,
                                    }}
                                  >
                                    {t.tag}
                                  </span>
                                );
                              })
                            ) : (
                              <>
                                {option.tag && (
                                  option.tagDotOnly ? (
                                    <span
                                      title={option.tag}
                                      className="shrink-0 rounded-full"
                                      style={{
                                        width: 8,
                                        height: 8,
                                        background: isHighlighted ? "#fff" : TAG_COLORS[option.tagColor ?? "blue"].fg,
                                      }}
                                    />
                                  ) : option.tag === "ONLINE" ? (
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-bold text-[10px]"
                                      style={{
                                        background: isHighlighted ? "#fff" : "#fde047",
                                        color: "#000",
                                        boxShadow: isHighlighted ? "none" : "0 1px 2px rgba(0,0,0,0.06)",
                                      }}
                                    >
                                      ONLINE
                                    </span>
                                  ) : (
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${
                                        option.tag === "BLAST-IN" ? "text-[10px]" : "text-xs"
                                      }`}
                                      style={{
                                        background: isHighlighted ? "rgba(255,255,255,0.2)" : TAG_COLORS[option.tagColor ?? "blue"].bg,
                                        color: isHighlighted ? "#fff" : TAG_COLORS[option.tagColor ?? "blue"].fg,
                                      }}
                                    >
                                      {option.tag}
                                    </span>
                                  )
                                )}
                                {option.tag2 && (
                                  option.tag2 === "ONLINE" ? (
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-bold text-[10px]"
                                      style={{
                                        background: isHighlighted ? "#fff" : "#fde047",
                                        color: "#000",
                                        boxShadow: isHighlighted ? "none" : "0 1px 2px rgba(0,0,0,0.06)",
                                      }}
                                    >
                                      ONLINE
                                    </span>
                                  ) : (
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${
                                        option.tag2 === "BLAST-IN" ? "text-[10px]" : "text-xs"
                                      }`}
                                      style={{
                                        background: isHighlighted ? "rgba(255,255,255,0.2)" : TAG_COLORS[option.tag2Color ?? "green"].bg,
                                        color: isHighlighted ? "#fff" : TAG_COLORS[option.tag2Color ?? "green"].fg,
                                      }}
                                    >
                                      {option.tag2}
                                    </span>
                                  )
                                )}
                                {option.tag3 && (
                                  option.tag3 === "ONLINE" ? (
                                    <span
                                      className="shrink-0 px-1.5 py-0.5 rounded font-bold text-[10px]"
                                      style={{
                                        background: isHighlighted ? "#fff" : "#fde047",
                                        color: "#000",
                                        boxShadow: isHighlighted ? "none" : "0 1px 2px rgba(0,0,0,0.06)",
                                      }}
                                    >
                                      ONLINE
                                    </span>
                                  ) : (
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 rounded font-bold ${
                                        option.tag3 === "BLAST-IN" ? "text-[10px]" : "text-xs"
                                      }`}
                                      style={{
                                        background: isHighlighted ? "#fff" : TAG_COLORS[option.tag3Color ?? "orange"].fg,
                                        color: isHighlighted ? TAG_COLORS[option.tag3Color ?? "orange"].fg : "#fff",
                                        boxShadow: isHighlighted ? "none" : "0 0 0 1px rgba(0,0,0,0.06)",
                                      }}
                                    >
                                      {option.tag3}
                                    </span>
                                  )
                                )}
                              </>
                            )}
                          </span>
                          {option.sublabel && (
                            <span
                              className="block text-xs whitespace-normal break-words mt-0.5 leading-snug"
                              style={{ color: isHighlighted ? "rgba(255,255,255,0.8)" : "var(--color-text-muted)" }}
                            >
                              {option.sublabel}
                            </span>
                          )}
                        </span>
                        {isSelected && (
                          <span
                            className="text-xs shrink-0 mt-0.5 font-bold"
                            style={{ color: isHighlighted ? "#fff" : "var(--color-blue)" }}
                          >
                            ✓
                          </span>
                        )}
                      </li>
                    </Fragment>
                  );
                });
              })()}
              {hiddenCount > 0 && (
                <li className="px-3 py-2 text-xs" style={{ color: "var(--color-text-faint)" }}>
                  +{hiddenCount} lainnya - ketik lebih spesifik untuk mempersempit
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
