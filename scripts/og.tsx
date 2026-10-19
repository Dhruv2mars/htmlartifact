// Renders the social preview (web/public/og.png) with Satori: the hero's
// headline and seal. Run after changing either: bun scripts/og.tsx
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import satori from "satori";
import { makeSeal } from "../web/app/lib/seal.ts";

const root = new URL("..", import.meta.url).pathname;
const font = (weight: number) => readFile(`${root}node_modules/@fontsource/archivo/files/archivo-latin-${weight}-normal.woff`);

function sealSvg(id: string, color: string, px: number): string {
  const seal = makeSeal(id, 1);
  const width = (0.9 * 100) / px;
  const defs = seal.layers.map((l, i) => `<path id="l${i}" d="${l.d}"/>`).join("");
  const uses = seal.layers
    .map((l, i) => Array.from({ length: l.copies }, (_, k) => `<use href="#l${i}" transform="rotate(${(k * l.step).toFixed(3)} 50 50)"/>`).join(""))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="${px}" height="${px}"><defs>${defs}</defs><g fill="none" stroke="${color}" stroke-width="${width}">${uses}</g></svg>`;
}

const seal = `data:image/svg+xml;base64,${Buffer.from(sealSvg("k3j9x0a1b2c4", "#2337c6", 520)).toString("base64")}`;
const mark = `data:image/svg+xml;base64,${Buffer.from(sealSvg("htmlartifact", "#2337c6", 44)).toString("base64")}`;

const svg = await satori(
  <div style={{ width: 1200, height: 630, display: "flex", background: "#f5f6f8", position: "relative", fontFamily: "Archivo", color: "#121a33" }}>
    <img src={seal} width={520} height={520} style={{ position: "absolute", right: 40, top: 55 }} />
    <div style={{ display: "flex", flexDirection: "column", padding: "64px 72px", width: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={mark} width={44} height={44} />
        <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6 }}>htmlartifact</span>
      </div>
      <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -6, lineHeight: 0.92, marginTop: 92 }}>Members only.</div>
      <div style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.35, color: "#2b3452", marginTop: 36, width: 660 }}>
        Private links for the HTML your coding agents write. Only your workspace can open them.
      </div>
    </div>
  </div>,
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Archivo", data: await font(800), weight: 800, style: "normal" },
      { name: "Archivo", data: await font(500), weight: 500, style: "normal" }
    ]
  }
);
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
await Bun.write(`${root}web/public/og.png`, png);
console.log(`web/public/og.png (${(png.length / 1024).toFixed(0)} KiB)`);
