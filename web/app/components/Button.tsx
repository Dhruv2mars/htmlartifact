import { cva, type VariantProps } from "class-variance-authority";
import { cx } from "../lib/cx";

// Controls: 8px corners, hairline edges, no shadows. The primary is the
// text colour itself (light on dark, dark on light): there is no brand hue.
const button = cva(
  "press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60",
  {
    variants: {
      tone: {
        ink: "bg-foreground text-background hover:bg-foreground/85",
        intaglio: "bg-foreground text-background hover:bg-foreground/85",
        line: "border border-border bg-card text-foreground hover:bg-surface",
        ghost: "text-muted hover:bg-surface hover:text-foreground"
      },
      size: {
        sm: "h-8 px-3 text-[13.5px]",
        md: "h-9 px-3.5 text-[14px]",
        lg: "h-11 px-4.5 text-[15px]"
      }
    },
    defaultVariants: { tone: "ink", size: "md" }
  }
);

export type ButtonStyle = VariantProps<typeof button>;

export function Button({
  tone,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle) {
  return <button className={cx(button({ tone, size }), className)} {...props} />;
}

export function ButtonLink({
  tone,
  size,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & ButtonStyle) {
  return <a className={cx(button({ tone, size }), className)} {...props} />;
}
