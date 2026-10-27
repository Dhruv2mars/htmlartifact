// Guilloche seals: the medallions on banknotes and certificates, generated
// from an artifact id. Same id, same seal, on the server and in the browser.
//
// A seal is a rope band (fine sine waves woven by rotating copies of one
// curve), a rosette with a second, fainter family of petals crossing it (the
// lattice), a small core, and a frame: one hairline at small sizes, two plus
// a ring of microprint carrying the id at large ones. Every curve is one path
// plus rotated <use> copies, so a seal stays a few KB however dense it looks.

interface SealPath {
  d: string;
  copies: number;
  step: number; // degrees between copies
  opacity: number;
  weight: number; // stroke, in screen px
}

// One ring of the seal: everything in it turns together.
export interface SealLayer {
  paths: SealPath[];
}

export interface Seal {
  layers: SealLayer[]; // 0 rope, 1 rosette, 2 core
  frame: { rings: Array<{ r: number; opacity: number; weight: number }>; text: string | null };
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
    d += `${i ? "L" : "M"}${(50 + r * Math.cos(t)).toFixed(2)} ${(50 + r * Math.sin(t)).toFixed(2)}`;
  }
  return `${d}Z`;
}

// The radius the microprint runs along, and the text that fills it.
export const SEAL_TEXT_RADIUS = 47.1;

// `size` is the rendered size in px: small seals drop copies, the lattice and
// the microprint, or they turn to mush.
export function makeSeal(id: string, size = 40): Seal {
  const r = rng(id);
  const tier = size >= 120 ? 3 : size >= 64 ? 2 : size >= 32 ? 1 : 0;
  const pts = (n: number) => Math.max(96, Math.round(n * [0.45, 0.6, 0.8, 1][tier]!));

  // Rope: a sine wave around the rim, woven with rotated copies of itself.
  const n1 = int(r, 16, 26);
  const a1 = real(r, 3, 4.2);
  const ropeCopies = [2, 3, 5, 8][tier]!;
  const rope = polar((t) => 40.2 + a1 * Math.sin(n1 * t), pts(n1 * 16));

  // Rosette: deep petals, and a fainter family offset by half a petal whose
  // crossings make the lattice of a banknote corner.
  const n2 = int(r, 5, 11);
  const a2 = real(r, 10, 13.5);
  const q2 = real(r, 0.08, 0.26);
  const petal = (k: number, phase: number) => (t: number) =>
    21.5 + a2 * k * Math.cos(n2 * t + phase) * (1 - q2 + q2 * Math.cos(2 * n2 * t));
  const rosetteCopies = [3, 4, 5, 8][tier]!;
  const rosetteStep = 360 / n2 / rosetteCopies;

  // Core: a small star inside the petals.
  const n3 = int(r, 8, 14);
  const a3 = real(r, 1.8, 2.8);

  const rings = [{ r: 48.6, opacity: 1, weight: tier === 0 ? 1.1 : 0.8 }];
  if (tier >= 2) rings.push({ r: tier === 3 ? 45.6 : 46, opacity: 0.55, weight: 0.6 });

  return {
    layers: [
      { paths: [{ d: rope, copies: ropeCopies, step: 180 / n1 / ropeCopies, opacity: 0.55, weight: tier === 3 ? 0.55 : 0.7 }] },
      {
        paths: [
          { d: polar(petal(1, 0), pts(n2 * 40)), copies: rosetteCopies, step: rosetteStep, opacity: 1, weight: tier === 3 ? 0.65 : 0.8 },
          ...(tier >= 2
            ? [{ d: polar(petal(0.72, Math.PI / n2), pts(n2 * 40)), copies: rosetteCopies, step: rosetteStep, opacity: 0.42, weight: 0.55 }]
            : [])
        ]
      },
      { paths: [{ d: polar((t) => 6 + a3 * Math.sin(n3 * t), pts(n3 * 14)), copies: 1, step: 0, opacity: 1, weight: 0.8 }] }
    ],
    frame: { rings, text: tier === 3 ? sealText(id) : null }
  };
}

// "MEMBERS ONLY • K3J9X0A1B2C4 • " repeated to go once around the rim.
function sealText(id: string): string {
  const unit = `MEMBERS ONLY • ${id.toUpperCase().slice(0, 24)} • `;
  const reps = Math.max(1, Math.round((2 * Math.PI * SEAL_TEXT_RADIUS) / (unit.length * 1.62)));
  return unit.repeat(reps);
}

// The seal as one standalone SVG string, for places without React: the OG
// image, the artifact viewer's bar, static pages. `color` is any CSS colour.
export function sealSvg(id: string, size: number, color: string): string {
  const seal = makeSeal(id, size);
  const units = (px: number) => ((px * 100) / size).toFixed(3);
  let defs = "";
  let body = "";
  seal.layers.forEach((layer, i) =>
    layer.paths.forEach((p, j) => {
      const ref = `s${i}${j}`;
      defs += `<path id="${ref}" d="${p.d}"/>`;
      body += `<g stroke-opacity="${p.opacity}" stroke-width="${units(p.weight)}">`;
      for (let k = 0; k < p.copies; k++) body += `<use href="#${ref}"${k ? ` transform="rotate(${(k * p.step).toFixed(3)} 50 50)"` : ""}/>`;
      body += "</g>";
    })
  );
  for (const ring of seal.frame.rings) body += `<circle cx="50" cy="50" r="${ring.r}" stroke-opacity="${ring.opacity}" stroke-width="${units(ring.weight)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 102 102" width="${size}" height="${size}" aria-hidden="true"><defs>${defs}</defs><g fill="none" stroke="${color}">${body}</g><circle cx="50" cy="50" r="1.8" fill="${color}"/></svg>`;
}
