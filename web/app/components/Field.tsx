import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { AlertIcon } from "./icons";

const inputClass =
  "h-11 w-full min-w-0 rounded-control border border-rule-2 bg-paper-2 px-3.5 text-[16px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fog hover:border-fog/50 focus:border-intaglio focus:shadow-[0_0_0_3px_var(--wash)] aria-invalid:border-deny aria-invalid:focus:shadow-[0_0_0_3px_var(--deny-wash)] sm:text-[15px]";

// A form field with a visible label, an optional hint and an error, all tied
// to the input for screen readers.
export function Field({
  label,
  hint,
  error,
  className,
  inputClassName,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; inputClassName?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={id} className="block text-[13.5px] font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-[13px] leading-relaxed text-fog">
          {hint}
        </p>
      )}
      <input
        id={id}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        className={cx(inputClass, "mt-2", inputClassName)}
        {...input}
      />
      {error && (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-[13.5px] leading-snug text-deny">
          <AlertIcon className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
