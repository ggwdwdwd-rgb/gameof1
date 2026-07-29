import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db } from "./index.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function runMigrations(): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
    });
    apply();
    console.log(`[migrate] применена: ${file}`);
  }

  console.log(`[migrate] готово, всего применённых миграций: ${applied.size + files.filter((f) => !applied.has(f)).length}`);
}

// Запускать SQL сразу только когда файл вызван напрямую (`npm run migrate`),
// а не когда его импортирует index.ts при старте сервера.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMigrations();
}
