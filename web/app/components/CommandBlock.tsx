import { useRef } from "react";
import { CopyButton, useCopy } from "./Copy";

// Commands someone should read in full before running: they wrap instead of
// truncating, and one Copy takes them all (comments stripped).
export function CommandBlock({ commands, note }: { commands: string[]; note?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, copy] = useCopy(commands.join("\n"), pre);
  return (
    <div className="w-full overflow-hidden rounded-card border border-line bg-card text-left">
      <div className="flex items-start gap-3 py-3 pl-4 pr-2">
        <pre ref={pre} className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.7] text-foreground">
          {commands.map((c) => (
            <span key={c} className="block">
              <span aria-hidden className="select-none text-muted">
                ${" "}
              </span>
              {c}
            </span>
          ))}
        </pre>
        <CopyButton
          state={state}
          onCopy={copy}
          what={commands.length > 1 ? "Commands" : "Command"}
          accessibleLabel={commands.length > 1 ? "Copy commands" : `Copy command: ${commands[0]}`}
          compact
          feedback="left"
          tone="ghost"
        />
      </div>
      {note && <p className="border-t border-line bg-surface/60 px-4 py-2.5 text-[13px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
