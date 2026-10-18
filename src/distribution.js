import fs from "node:fs";
import { config } from "./config.js";
import { getHomeUrl } from "./public-url.js";

// The server hands out its own CLI and the default agent skills, so a new
// teammate needs one line: curl -fsSL https://<server>/install.sh | sh
// The CLI bundle (bun run build:cli) gets this server's URL baked in.

const ROOT = new URL("../", import.meta.url);
const SKILLS_DIR = new URL("skills/", ROOT);
const CLI_BUNDLE = new URL("dist/htmlartifact.mjs", ROOT);
const SKILL_NAME = /^htmlartifact(-[a-z0-9]+)*$/;

export function registerDistributionRoutes(app) {
  app.get("/install.sh", (req, res) => {
    res.type("text/x-shellscript").send(installScript(homeUrl(), listSkills()));
  });

  app.get("/cli/htmlartifact.mjs", (req, res) => {
    let source;
    try {
      source = fs.readFileSync(CLI_BUNDLE, "utf8");
    } catch {
      return res.status(503).type("text").send("CLI bundle missing on this server. Run: bun run build:cli\n");
    }
    res
      .type("text/javascript")
      .send(source.replaceAll("__HTMLARTIFACT_API_URL__", homeUrl()));
  });

  app.get("/skills/:name/SKILL.md", (req, res, next) => {
    if (!listSkills().includes(req.params.name)) return next();
    res.type("text/markdown").send(fs.readFileSync(new URL(`${req.params.name}/SKILL.md`, SKILLS_DIR)));
  });
}

export function listSkills() {
  try {
    return fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SKILL_NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function homeUrl() {
  return getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: "" });
}

// POSIX sh. Writes only htmlartifact* paths: the CLI bundle into
// ~/.local/share/htmlartifact, a launcher into $HTMLARTIFACT_BIN_DIR (default
// ~/.local/bin), and each skill into every agent skills folder that exists
// (~/.agents, ~/.claude, ~/.codex).
function installScript(url, skills) {
  return `#!/bin/sh
# htmlartifact installer for ${url}
set -eu

URL='${url}'
BIN_DIR="\${HTMLARTIFACT_BIN_DIR:-$HOME/.local/bin}"
SKILLS='${skills.join(" ")}'

command -v node >/dev/null 2>&1 || { echo "htmlartifact needs Node.js 20+ (https://nodejs.org)." >&2; exit 1; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi
}

LIB_DIR="\${XDG_DATA_HOME:-$HOME/.local/share}/htmlartifact"
mkdir -p "$BIN_DIR" "$LIB_DIR"
fetch "$URL/cli/htmlartifact.mjs" "$LIB_DIR/htmlartifact.mjs.tmp"
mv "$LIB_DIR/htmlartifact.mjs.tmp" "$LIB_DIR/htmlartifact.mjs"
printf '#!/bin/sh\nexec node "%s/htmlartifact.mjs" "$@"\n' "$LIB_DIR" > "$BIN_DIR/htmlartifact"
chmod 755 "$BIN_DIR/htmlartifact"
echo "Installed CLI: $BIN_DIR/htmlartifact"

mkdir -p "$HOME/.agents/skills"
for root in "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  parent=$(dirname "$root")
  [ -d "$parent" ] || continue
  for skill in $SKILLS; do
    mkdir -p "$root/$skill"
    fetch "$URL/skills/$skill/SKILL.md" "$root/$skill/SKILL.md"
  done
  echo "Installed skills ($SKILLS) into $root"
done

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to your PATH, e.g.: export PATH=\\"$BIN_DIR:\\$PATH\\"" ;;
esac
echo "Next: htmlartifact login"
`;
}
