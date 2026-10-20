import fs from "node:fs";
import path from "node:path";

import { attempt, cliError } from "./errors.ts";

export interface UploadSource {
  resolved: string;
  dir: string;
  filename: string;
  body: { html: string; files?: undefined } | { files: Array<{ path: string; html: string }>; html?: undefined };
}

// Strict UTF-8, keeping a byte order mark: the HTML is sent exactly as saved,
// and a file in another encoding is refused rather than silently altered.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function readHtml(file: string): string {
  const bytes = fs.readFileSync(file);
  try {
    return utf8.decode(bytes);
  } catch {
    throw cliError(`${file} is not valid UTF-8. Save it as UTF-8 (htmlartifact publishes UTF-8 only) and try again.`, "validation");
  }
}

// Reads an upload target: one HTML file, or every .html file under a folder
// (skipping dotfiles and node_modules) as pages keyed by relative path.
export const readUploadSource = (target: string) =>
  attempt((): UploadSource => {
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) {
      throw cliError(`Path does not exist: ${resolved}`, "notFound");
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return {
        resolved,
        dir: path.dirname(resolved),
        filename: path.basename(resolved),
        body: { html: readHtml(resolved) }
      };
    }

    const files: Array<{ path: string; html: string }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".html")) {
          files.push({
            path: path.relative(resolved, full).split(path.sep).join("/"),
            html: readHtml(full)
          });
        }
      }
    };
    walk(resolved);
    if (!files.length) {
      throw cliError(`No .html files found in ${resolved}`, "validation");
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { resolved, dir: resolved, filename: path.basename(resolved), body: { files } };
  });
