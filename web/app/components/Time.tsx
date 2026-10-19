import { fullDate, relativeTime } from "../lib/time";

export function Time({ iso, className }: { iso: string | null; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullDate(iso)} className={className} suppressHydrationWarning>
      {relativeTime(iso)}
    </time>
  );
}
