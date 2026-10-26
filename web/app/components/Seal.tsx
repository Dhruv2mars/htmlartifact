import { useEffect, useId, useMemo, useState } from "react";
import { cx } from "../lib/cx";
import { makeSeal, SEAL_TEXT_RADIUS } from "../lib/seal";

// An artifact's seal (lib/seal.ts). Each ring is its own <svg>, stacked, so
// turning a ring is a composited transform rather than a repaint of the whole
// seal. Decorative unless given a label.
// Lists render seals in the browser: dozens of them would cost the Worker
// more CPU than Workers Free allows. Server and first paint get a faint
// ring of the same size, so nothing shifts when the seal arrives.
export function Seal(props: SealProps & { deferred?: boolean }) {
  const { deferred, ...rest } = props;
  const [ready, setReady] = useState(!deferred);
  useEffect(() => setReady(true), []);
  if (ready) return <SealArt {...rest} className={cx(deferred && "seal-in", rest.className)} />;
  const size = rest.size ?? 40;
  return (
    <span
      aria-hidden
      className={cx("block shrink-0 rounded-full border border-rule", rest.className)}
      style={{ width: size, height: size, ...rest.style }}
    />
  );
}

interface SealProps {
  id: string;
  size?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  // Wrap each ring (e.g. in a motion.div) without touching the ring itself,
  // which CSS may already be animating.
  wrapLayer?: (index: number, ring: React.ReactNode) => React.ReactNode;
}

function SealArt({ id, size = 40, label, className, style, wrapLayer }: SealProps) {
  const seal = useMemo(() => makeSeal(id, size), [id, size]);
  const uid = `s${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // Hairlines in screen pixels whatever the size (<use> ignores
  // non-scaling-stroke, so convert to viewBox units).
  const units = (px: number) => (px * 100) / size;
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
              {layer.paths.map((p, j) => (
                <path key={j} id={`${uid}-${i}-${j}`} d={p.d} />
              ))}
            </defs>
            {layer.paths.map((p, j) => (
              <g key={j} fill="none" stroke="currentColor" strokeOpacity={p.opacity} strokeWidth={units(p.weight)}>
                {Array.from({ length: p.copies }, (_, k) => (
                  <use key={k} href={`#${uid}-${i}-${j}`} transform={k ? `rotate(${(k * p.step).toFixed(3)} 50 50)` : undefined} />
                ))}
              </g>
            ))}
            {i === 2 && <circle cx="50" cy="50" r="1.8" fill="currentColor" />}
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
      <svg data-layer="frame" viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {seal.frame.rings.map((ring) => (
          <circle key={ring.r} cx="50" cy="50" r={ring.r} fill="none" stroke="currentColor" strokeOpacity={ring.opacity} strokeWidth={units(ring.weight)} />
        ))}
        {seal.frame.text && (
          <>
            <defs>
              <path id={`${uid}-rim`} d={`M50 50m-${SEAL_TEXT_RADIUS} 0a${SEAL_TEXT_RADIUS} ${SEAL_TEXT_RADIUS} 0 1 1 ${SEAL_TEXT_RADIUS * 2} 0a${SEAL_TEXT_RADIUS} ${SEAL_TEXT_RADIUS} 0 1 1 -${SEAL_TEXT_RADIUS * 2} 0`} />
            </defs>
            <text className="font-mono" fontSize="2.1" fill="currentColor" fillOpacity="0.8" dominantBaseline="middle">
              <textPath href={`#${uid}-rim`} textLength={(2 * Math.PI * SEAL_TEXT_RADIUS - 0.5).toFixed(1)} lengthAdjust="spacing">
                {seal.frame.text}
              </textPath>
            </text>
          </>
        )}
      </svg>
    </span>
  );
}
