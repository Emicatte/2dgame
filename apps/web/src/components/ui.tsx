import type { ButtonHTMLAttributes, ReactNode } from "react";
import { sfx } from "../game/audio/sfx.ts";

type Variant = "primary" | "ghost" | "danger" | "default";

export function Button({
  variant = "default",
  size,
  block,
  className,
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "lg"; block?: boolean }) {
  const cls = [
    "btn",
    variant !== "default" ? `btn--${variant}` : "",
    size ? `btn--${size}` : "",
    block ? "btn--block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onMouseEnter={() => sfx.ui("hover")}
      onClick={(e) => {
        sfx.unlock();
        sfx.ui("click");
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {title && <h3 className="panel__title">{title}</h3>}
      {children}
    </section>
  );
}

export function LevelChip({ level }: { level: number }) {
  return (
    <span className="level-chip" title={`Level ${level}`}>
      {level}
    </span>
  );
}

export function SheetHeader({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="sheet__head">
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back">
        ← Back
      </Button>
      <h2>{title}</h2>
      <span className="spacer" />
      {children}
    </header>
  );
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
