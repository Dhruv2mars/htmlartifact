import { Seal } from "./Seal";

// The wordmark with the house seal (generated from the product's own name).
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="group inline-flex items-center gap-2.5 rounded-md text-ink" aria-label="htmlartifact home">
      <Seal id="htmlartifact" size={26} stroke={0.7} className="transition-[rotate] duration-300 ease-out group-hover:rotate-[24deg] motion-reduce:transition-none" />
      <span className="font-wide text-[17px] font-[650] tracking-[-0.02em]">htmlartifact</span>
    </a>
  );
}
