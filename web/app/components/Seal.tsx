import { useId, useMemo } from "react";
import { cx } from "../lib/cx";
import { makeSeal } from "../lib/seal";

// An artifact's seal (lib/seal.ts). Each ring is its own <svg>, stacked, so
// turning a ring is a composited transform rather than a repaint of the whole
// seal. Decorative unless given a label.
export function Seal({
  id,
  size = 40,
  detail,
  stroke,
  label,
  className,
  style,
  wrapLayer
}: {
  id: string;
  size?: number;
  detail?: number;
  stroke?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  // Wrap each ring (e.g. in a motion.div) without touching the ring itself,
  // which CSS may already be animating.
  wrapLayer?: (index: number, ring: React.ReactNode) => React.ReactNode;
}) {
  const seal = useMemo(() => makeSeal(id, detail ?? (size >= 200 ? 1 : size >= 96 ? 0.55 : 0.3)), [id, detail, size]);
  const uid = `s${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // Hairlines in screen pixels whatever the size (<use> ignores
  // non-scaling-stroke, so convert to viewBox units).
  const width = ((stroke ?? (size >= 200 ? 0.8 : size >= 96 ? 0.75 : 0.85)) * 100) / size;
  return (
    <span
      className={cx("seal relative block shrink-0", className)}
      style={{ width: size, height: size, color: `var(--seal-${seal.ink})`, ...style }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {seal.layers.map((layer, i) => {
        const ring = (
          <svg key={i} data-layer={i} viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <path id={`${uid}-${i}`} d={layer.d} />
            </defs>
            <g fill="none" stroke="currentColor" strokeWidth={width}>
              {Array.from({ length: layer.copies }, (_, k) => (
                <use key={k} href={`#${uid}-${i}`} transform={k ? `rotate(${(k * layer.step).toFixed(3)} 50 50)` : undefined} />
              ))}
            </g>
          </svg>
        );
        return wrapLayer ? (
          <span key={i} className="absolute inset-0">
            {wrapLayer(i, ring)}
          </span>
        ) : (
          ring
        );
      })}
    </span>
  );
}
