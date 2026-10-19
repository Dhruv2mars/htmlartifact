// CHANGELOG.md helper for CI and releases.
//   bun scripts/changelog.ts check            -> fails unless CHANGELOG.md has a section for package.json's version
//   bun scripts/changelog.ts notes <version>  -> prints that version's section (GitHub release notes)
const root = new URL("..", import.meta.url).pathname;
const changelog = await Bun.file(`${root}CHANGELOG.md`).text();
const { version } = await Bun.file(`${root}package.json`).json();

function section(v: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${v}]`));
  if (start < 0) return null;
  // Up to the next version, or the link definitions at the bottom.
  const end = lines.findIndex((line, i) => i > start && (line.startsWith("## ") || /^\[[^\]]*\]: /.test(line)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

const [command, arg] = process.argv.slice(2);
if (command === "check") {
  if (!section(version)) {
    console.error(`CHANGELOG.md has no "## [${version}]" section for package.json version ${version}.`);
    process.exit(1);
  }
  console.log(`CHANGELOG.md documents ${version}.`);
} else if (command === "notes" && arg) {
  const notes = section(arg.replace(/^v/, ""));
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${arg}.`);
    process.exit(1);
  }
  console.log(notes);
} else {
  console.error("usage: bun scripts/changelog.ts check | notes <version>");
  process.exit(2);
}
