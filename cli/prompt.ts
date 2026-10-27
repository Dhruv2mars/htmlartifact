import { createInterface } from "node:readline/promises";
import { Effect } from "effect";

// Questions are only asked of a person at a terminal. Scripts, agents and CI
// (pipes) never wait on a prompt: they get an error that names the flag to pass.
export const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stderr.isTTY);

// Asks on stderr (stdout stays the command's output) and returns the trimmed
// answer, or null if input ends first (Ctrl-D). Ctrl-C exits as it would anywhere.
export const ask = (question: string): Effect.Effect<string | null> =>
  Effect.promise(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.on("SIGINT", () => {
      rl.close();
      process.kill(process.pid, "SIGINT");
    });
    const closed = new Promise<null>((resolve) => rl.once("close", () => resolve(null)));
    try {
      const answer = await Promise.race([rl.question(question).catch(() => null), closed]);
      return answer === null ? null : answer.trim();
    } finally {
      rl.close();
    }
  });
