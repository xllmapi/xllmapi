import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply Postgres migrations");
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(scriptDir, "../../../../infra/sql/postgres");

const migrationFiles = readdirSync(migrationsDir)
  .filter((fileName) => extname(fileName) === ".sql")
  .sort();

const client = new Client({
  connectionString: databaseUrl
});

const main = async () => {
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const fileName of migrationFiles) {
      const version = fileName;
      const exists = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1",
        [version]
      );

      if (exists.rowCount && exists.rowCount > 0) {
        console.log(`skip ${version}`);
        continue;
      }

      const sql = readFileSync(resolve(migrationsDir, fileName), "utf8");
      console.log(`apply ${version}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [version]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
