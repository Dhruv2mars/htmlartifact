// Small stroke icons, 16px grid, currentColor.
type P = React.SVGProps<SVGSVGElement>;
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const CopyIcon = (p: P) => (
  <svg {...base} {...p}><rect x="5.25" y="5.25" width="8" height="8" rx="1.75" /><path d="M10.75 5.25V3.5a1.25 1.25 0 0 0-1.25-1.25h-6A1.25 1.25 0 0 0 2.25 3.5v6a1.25 1.25 0 0 0 1.25 1.25h1.75" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} {...p}><path d="m3.25 8.5 3 3 6.5-7" /></svg>
);
export const LockIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></svg>
);
export const SunIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="8" r="2.75" /><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" /></svg>
);
export const MoonIcon = (p: P) => (
  <svg {...base} {...p}><path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z" /></svg>
);
export const SystemIcon = (p: P) => (
  <svg {...base} {...p}><rect x="2" y="2.75" width="12" height="8.5" rx="1.5" /><path d="M5.5 13.75h5M8 11.25v2.5" /></svg>
);
export const GitHubIcon = (p: P) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}><path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.74.54 1.49v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2Z" /></svg>
);
export const ArrowUpRight = (p: P) => (
  <svg {...base} {...p}><path d="M5 11 11 5M6 5h5v5" /></svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base} {...p}><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3.5 3.5" /></svg>
);
