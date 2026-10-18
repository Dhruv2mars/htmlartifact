import fs from "node:fs";
import path from "node:path";

import { attempt, cliError } from "./errors.ts";

export interface UploadSource {
  resolved: string;
  dir: string;
  filename: string;
  body: { html: string; files?: undefined } | { files: Array<{ path: string; html: string }>; html?: undefined };
}

// Reads an upload target: one HTML file, or every .html file under a folder
// (skipping dotfiles and node_modules) as pages keyed by relative path.
export const readUploadSource = (target: string) =>
  attempt((): UploadSource => {
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) {
      throw cliError(`Path does not exist: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return {
        resolved,
        dir: path.dirname(resolved),
        filename: path.basename(resolved),
        body: { html: fs.readFileSync(resolved, "utf8") }
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
            html: fs.readFileSync(full, "utf8")
          });
        }
      }
    };
    walk(resolved);
    if (!files.length) {
      throw cliError(`No .html files found in ${resolved}`);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { resolved, dir: resolved, filename: path.basename(resolved), body: { files } };
  });
