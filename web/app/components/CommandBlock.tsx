import { CopyText } from "./CopyText";

// Commands someone should read in full before running: they wrap instead of
// truncating, and one Copy takes them all (comments stripped).
export function CommandBlock({ commands, note }: { commands: string[]; note?: string }) {
  return (
    <div className="w-full overflow-hidden rounded-card border border-rule bg-paper-2 text-left">
      <div className="flex items-start gap-3 py-3 pl-4 pr-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.7] text-ink">
          {commands.map((c) => (
            <span key={c} className="block">
              <span aria-hidden className="select-none text-fog">
                ${" "}
              </span>
              {c}
            </span>
          ))}
        </pre>
        <CopyText text={commands.join("\n")} />
      </div>
      {note && <p className="border-t border-rule bg-paper-3/60 px-4 py-2.5 text-[13px] leading-relaxed text-fog">{note}</p>}
    </div>
  );
}
