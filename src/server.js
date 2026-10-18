import { createApp } from "./api.js";
import { assertAuthConfigured, config } from "./config.js";
import { initDb } from "./db.js";
import { assertStorageConfigured } from "./storage.js";

async function main() {
  assertAuthConfigured();
  assertStorageConfigured();
  await initDb();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`htmlartifact listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
