"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Condition } from "@/core/death";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "ghost" | "quiet" | "danger";
const base =
  "inline-flex items-center justify-center gap-2 rounded-[10px] text-sm font-semibold transition-[background,color,border,transform,box-shadow] duration-200 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] select-none";
const variants: Record<Variant, string> = {
  primary:
    "bg-ember text-on-ember hover:bg-ember-bright shadow-[0_0_0_1px_rgba(255,205,125,.3),0_8px_30px_-10px_rgba(240,166,60,.55)]",
  ghost: "border border-line-strong text-bone hover:border-bone-3 hover:bg-loam-2",
  quiet: "text-bone-2 hover:text-bone hover:bg-loam-2",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
};
const sizes = { sm: "h-9 px-3", md: "h-11 px-5", lg: "h-14 px-7 text-base" } as const;

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return <button ref={ref} className={cx(base, variants[variant], sizes[size], className)} {...props} />;
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: keyof typeof sizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

export const CONDITION_STYLE: Record<Condition | "STIRRING" | "RISEN" | "RESTING", { label: string; color: string }> = {
  DEAD: { label: "Dead", color: "var(--dead)" },
  CRITICAL: { label: "Critical", color: "var(--critical)" },
  FADING: { label: "Fading", color: "var(--fading)" },
  ALIVE: { label: "Alive", color: "var(--alive)" },
  UNKNOWN: { label: "Unknown", color: "var(--unknown)" },
  RESTING: { label: "Resting", color: "var(--dead)" },
  STIRRING: { label: "Stirring", color: "var(--ember)" },
  RISEN: { label: "Risen", color: "var(--ember-bright)" },
};

export function ConditionTag({
  condition,
  className,
  pulse,
}: {
  condition: keyof typeof CONDITION_STYLE;
  className?: string;
  pulse?: boolean;
}) {
  const s = CONDITION_STYLE[condition];
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]", className)}
      style={{ color: s.color }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: s.color }} />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      </span>
      {s.label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton", className)} />;
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[16px] border border-line bg-loam-1/80", className)}>{children}</div>;
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular text-bone">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-bone-3">{hint}</div>}
    </div>
  );
}

export function TokenGlyph({ symbol, src, size = 36, dim }: { symbol: string; src?: string | null; size?: number; dim?: boolean }) {
  const initials = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-loam-3", dim && "grayscale")}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className={cx("h-full w-full object-cover", dim && "opacity-70")} loading="lazy" />
      ) : (
        <span className="font-display text-[0.8em] font-semibold text-bone-2" style={{ fontSize: size * 0.38 }}>
          {initials}
        </span>
      )}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[0.8125rem] text-bone-2", className)}>{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const c = tone === "danger" ? "border-danger/40 text-danger" : tone === "warn" ? "border-fading/40 text-fading" : "border-line-strong text-bone-2";
  return <div className={cx("rounded-[10px] border bg-loam-1 px-4 py-3 text-sm", c)}>{children}</div>;
}
