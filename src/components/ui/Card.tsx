import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className, padded = true, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]",
        padded && "p-5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-[var(--color-border)] pb-4 mb-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-semibold text-[var(--color-text)]", className)} {...props}>
      {children}
    </h3>
  );
}
