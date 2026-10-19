import { cva, type VariantProps } from "class-variance-authority";
import { cx } from "../lib/cx";

export const button = cva(
  "press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        ink: "bg-ink text-paper hover:bg-ink-2",
        intaglio: "bg-intaglio text-intaglio-ink hover:opacity-90",
        line: "border border-rule-2 bg-paper-2 text-ink hover:border-fog/60",
        ghost: "text-ink-2 hover:bg-wash hover:text-ink"
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-10 px-4.5 text-[15px]",
        lg: "h-12 px-6 text-base"
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
