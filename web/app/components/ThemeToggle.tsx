import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { MoonIcon, SunIcon, SystemIcon } from "./icons";

const ORDER = ["system", "light", "dark"] as const;

// Cycles system → light → dark. Renders a neutral icon until mounted, since
// the server can't know the theme.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted && (theme as (typeof ORDER)[number])) || "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  const Icon = current === "light" ? SunIcon : current === "dark" ? MoonIcon : SystemIcon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="press grid size-8 place-items-center rounded-control text-muted hover:bg-surface hover:text-foreground"
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      title={`Theme: ${current} (switch to ${next})`}
    >
      <Icon className="size-4" />
    </button>
  );
}
