import { useRef } from "react";
import { CopyButton, useCopy } from "./Copy";

// A shell command in a field, with a Copy control. The command breaks only
// between words (never inside a flag or an invite code), so nothing that
// matters is hidden. `large` is the landing's primary command.
export function CopyCommand({ command, large = false, className }: { command: string; large?: boolean; className?: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const [state, copy] = useCopy(command, text);
  return (
    <div
      className={`flex max-w-full items-center gap-3 rounded-control border border-border bg-card font-mono text-foreground ${large ? "min-h-12 py-1 pl-4 pr-2 text-[14px]" : "min-h-10 py-0.5 pl-3.5 pr-1 text-[13px]"} ${className ?? ""}`}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-2.5 py-1.5 leading-snug">
        <span aria-hidden className="select-none text-faint">
          $
        </span>
        <span ref={text} className="min-w-0">
          <Words text={command} />
        </span>
      </span>
      <CopyButton state={state} onCopy={copy} what="Command" accessibleLabel={`Copy command: ${command}`} compact />
    </div>
  );
}

// Words that wrap only at their spaces; one longer than the line still breaks.
function Words({ text }: { text: string }) {
  return text.split(/(\s+)/).map((part, i) =>
    i % 2 ? part : part ? <span key={i} className="inline-block max-w-full [overflow-wrap:anywhere]">{part}</span> : null
  );
}
