import type { ReactNode } from "react";
import { CopyCommand } from "./CopyCommand";
import { Seal } from "./Seal";

// An empty screen is an invitation to act: say what to run.
export function Empty({ seed, title, children, commands }: { seed: string; title: string; children: ReactNode; commands: string[] }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-rule-2 px-6 py-14 text-center sm:px-10">
      <Seal id={seed} size={88} className="mx-auto opacity-90" />
      <h2 className="mt-6 font-wide text-[22px] font-[680] tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mx-auto mt-2 max-w-[44ch] text-[15px] leading-relaxed text-fog">{children}</div>
      <div className="mt-7 flex flex-col items-center gap-2.5">
        {commands.map((c) => (
          <CopyCommand key={c} command={c} />
        ))}
      </div>
    </div>
  );
}
