// Guilloche seals: the rosettes on banknotes and certificates, generated from
// an artifact id. Same id, same seal, on the server and in the browser.
//
// Each layer is one closed curve plus rotated copies of it (an SVG <use> per
// copy), so a seal stays a few KB however dense it looks.

export const SEAL_INKS = ["#2337c6", "#0f7a6b", "#7a2e8c", "#9e2b3a", "#8f6410"] as const;
export const SEAL_INKS_DARK = ["#8c9bff", "#4fc9b4", "#d08ce0", "#ff8f9c", "#f0c060"] as const;

export interface SealLayer {
  d: string;
  copies: number;
  step: number; // degrees between copies
}

export interface Seal {
  ink: number; // index into SEAL_INKS
  layers: SealLayer[];
}

// FNV-1a, then mulberry32: small, fast, stable across engines.
function rng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const real = (r: () => number, min: number, max: number) => min + r() * (max - min);

// A closed polar curve r(θ) around (50, 50) as a path.
function polar(radius: (t: number) => number, points: number): string {
  let d = "";
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    const r = radius(t);
    const x = 50 + r * Math.cos(t);
    const y = 50 + r * Math.sin(t);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

// detail: 1 for hero-sized seals, lower for small ones (fewer points, copies).
export function makeSeal(id: string, detail = 1): Seal {
  const r = rng(id);
  const pts = (n: number) => Math.max(72, Math.round(n * detail));
  // Small seals keep the curves but drop most copies, or they turn to mush.
  const copies = (n: number) => (detail < 0.4 ? Math.max(2, Math.round(n * 0.4)) : Math.max(4, Math.round(n * Math.sqrt(detail))));

  // Outer band: a wave woven with a few shifted copies of itself.
  const n1 = int(r, 14, 22);
  const a1 = real(r, 4.5, 6.5);
  const band = polar((t) => 40.5 + a1 * Math.sin(n1 * t), pts(n1 * 20));
  const bandCopies = copies(int(r, 4, 6));

  // Rosette: deep petals whose overlaps make the lattice of a banknote corner.
  const n2 = int(r, 5, 9);
  const a2 = real(r, 11, 15);
  const q2 = real(r, 0.08, 0.2);
  const rosette = polar((t) => 22 + a2 * Math.cos(n2 * t) * (1 - q2 + q2 * Math.cos(2 * n2 * t)), pts(n2 * 48));
  const rosetteCopies = copies(int(r, 6, 9));

  // Core: a small star that sits inside the rosette's petals.
  const n3 = int(r, 7, 13);
  const a3 = real(r, 3, 5);
  const core = polar((t) => 7.5 + a3 * Math.sin(n3 * t), pts(n3 * 18));
  const coreCopies = copies(4);

  return {
    ink: int(r, 0, SEAL_INKS.length - 1),
    layers: [
      { d: band, copies: bandCopies, step: 360 / n1 / bandCopies },
      { d: rosette, copies: rosetteCopies, step: 360 / n2 / rosetteCopies },
      { d: core, copies: coreCopies, step: 360 / n3 / coreCopies }
    ]
  };
}
