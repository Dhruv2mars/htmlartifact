import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { Seal } from "./Seal";
import { sealSvg } from "../lib/seal";

// The hero's seal: hairline guilloche that catches light like foil. A
// conic sheen, masked to the seal's own linework, turns toward the pointer
// on a soft spring. Decorative: fine pointers only, never with reduced motion
// (it then rests at one angle).
export function FoilSeal({ id, size, label }: { id: string; size: number; label?: string }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const angle = useMotionValue(140);
  const spring = useSpring(angle, { stiffness: 70, damping: 20, mass: 1 });
  const sheen = useMotionTemplate`conic-gradient(from ${spring}deg at 50% 50%, transparent 0deg, #c4b5fd 50deg, #99f6e4 95deg, #fde68a 140deg, transparent 200deg, transparent 360deg)`;
  // The mask is the same seal drawn as one SVG (lib/seal.ts sealSvg), whose
  // viewBox has a 1-unit margin: the layer is 2% larger to line up.
  const mask = useMemo(() => `url("data:image/svg+xml,${encodeURIComponent(sealSvg(id, size, "#000"))}")`, [id, size]);

  useEffect(() => {
    if (reduce || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let cx = 0;
    let cy = 0;
    const measure = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) {
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2 + window.scrollY;
      }
    };
    const move = (e: PointerEvent) => {
      angle.set((Math.atan2(e.pageY - cy, e.pageX - cx) * 180) / Math.PI + 90);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", move);
    };
  }, [reduce, angle]);

  return (
    <div ref={box} className="lock relative" style={{ width: size, height: size, "--d": "200ms" } as React.CSSProperties}>
      <Seal id={id} size={size} label={label ?? `The seal of artifact ${id}`} />
      <motion.div
        aria-hidden
        className="rise pointer-events-none absolute -inset-[1%] opacity-90 mix-blend-normal dark:opacity-80"
        style={{
          background: sheen,
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          "--d": "900ms"
        } as never}
      />
    </div>
  );
}
