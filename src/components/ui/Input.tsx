import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-[var(--color-text)]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded border px-3 py-2 text-sm text-[var(--color-text)]",
            "bg-white placeholder:text-[var(--color-text-faint)]",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-[var(--color-blue)] focus:ring-offset-1",
            error
              ? "border-[var(--color-error)]"
              : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
            className
          )}
          {...props}
        />
        {hint && !error && (
          <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>
        )}
        {error && (
          <p className="text-xs text-[var(--color-error)]">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
