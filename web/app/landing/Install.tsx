import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CopyButton, useCopy } from "../components/Copy";

// The one command to start with. The runner cycles (npx, bunx, pnpm dlx) so
// people see theirs; Copy takes whichever is showing. Pointer or focus on
// the field pauses the cycle; reduced motion keeps npx.
const RUNNERS = ["npx", "bunx", "pnpm dlx"] as const;

export function Install({ command = "htmlartifact login", className }: { command?: string; className?: string }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  // Paused while pointed at or focused, tracked apart so leaving one keeps
  // the other's pause.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const text = useRef<HTMLSpanElement>(null);
  const full = `${RUNNERS[i]} ${command}`;
  const [state, copy] = useCopy(full, text);
  useEffect(() => {
    if (reduce || paused || state !== "idle") return;
    const t = setTimeout(() => setI((n) => (n + 1) % RUNNERS.length), 2600);
    return () => clearTimeout(t);
  }, [i, reduce, paused, state]);
  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`flex h-12 max-w-full items-center gap-3 rounded-control border border-border bg-card pl-4 pr-1.5 font-mono text-[14px] ${className ?? ""}`}
    >
      <span aria-hidden className="select-none text-faint">
        $
      </span>
      <span ref={text} className="flex min-w-0 flex-1 items-baseline whitespace-nowrap">
        <span className="relative inline-grid overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={RUNNERS[i]}
              initial={{ opacity: 0, transform: "translateY(60%)", filter: "blur(3px)" }}
              animate={{ opacity: 1, transform: "translateY(0%)", filter: "blur(0px)" }}
              exit={{ opacity: 0, transform: "translateY(-60%)", filter: "blur(3px)" }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              className="text-muted"
            >
              {RUNNERS[i]}
            </motion.span>
          </AnimatePresence>
        </span>
        <motion.span layout="position" transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}>
          &nbsp;{command}
        </motion.span>
      </span>
      <CopyButton state={state} onCopy={copy} what="Command" accessibleLabel={`Copy command: ${full}`} compact />
    </div>
  );
}
