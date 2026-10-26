import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { Seal } from "../components/Seal";

// The seal stamped on the hero's artifact. Its rings turn like the dials of a
// lock as the pointer moves across the page: decorative, so it rides a soft
// spring, and only with a fine pointer and motion allowed. Each ring is its
// own layer, rotated with a full transform string (composited).
const TURN = [10, -16, 24]; // degrees per ring at the edge of the viewport

function Ring({ value, turn, children }: { value: ReturnType<typeof useSpring>; turn: number; children: React.ReactNode }) {
  const deg = useTransform(value, (v) => v * turn);
  const transform = useMotionTemplate`rotate(${deg}deg)`;
  return (
    <motion.div className="absolute inset-0" style={{ transform }}>
      {children}
    </motion.div>
  );
}

export function HeroSeal({ id }: { id: string }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const spring = useSpring(x, { stiffness: 60, damping: 18, mass: 1 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    // Measured on mount and resize, never inside pointermove (no forced layout).
    let center = 0;
    const measure = () => {
      const rect = box.current?.getBoundingClientRect();
      if (rect) center = rect.left + rect.width / 2;
    };
    const onMove = (event: PointerEvent) => {
      x.set(Math.max(-1, Math.min(1, (event.clientX - center) / (window.innerWidth / 2))));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduce, x]);

  return (
    <div ref={box} className="hero-seal size-[84px] sm:size-[124px] lg:size-[148px]">
      <Seal
        id={id}
        size={148}
        className="size-full!"
        wrapLayer={(i, ring) => (
          <Ring value={spring} turn={TURN[i]!}>
            {ring}
          </Ring>
        )}
      />
    </div>
  );
}
