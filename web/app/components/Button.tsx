import { cva, type VariantProps } from "class-variance-authority";
import { cx } from "../lib/cx";

// Controls are squared-off (10px), like the fields of a printed form; only
// chips and the seal are round.
const button = cva(
  "press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60",
  {
    variants: {
      tone: {
        ink: "bg-ink text-paper hover:bg-ink-2",
        intaglio: "bg-intaglio text-intaglio-ink hover:bg-intaglio/90",
        line: "border border-rule-2 bg-paper-2 text-ink hover:border-fog/50 hover:bg-paper",
        ghost: "text-ink-2 hover:bg-wash hover:text-ink"
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-[14.5px]",
        lg: "h-12 px-5 text-[15.5px]"
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
