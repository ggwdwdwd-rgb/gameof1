import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env.js";

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);

// WAL — чтобы читатели (history.fetch) не блокировались писателем (msg.send) и наоборот.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
