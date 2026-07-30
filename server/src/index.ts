import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { cleanupMessages } from "./db/cleanup.js";
import { runMigrations } from "./db/migrate.js";
import { env } from "./env.js";
import { getSodium } from "./crypto/sodium.js";
import { handleConnection } from "./ws/connection.js";
import { connectedDeviceCount } from "./ws/registry.js";

runMigrations();
await getSodium(); // прогреваем WASM libsodium один раз до приёма соединений

const app = Fastify({
  logger: {
    level: env.logLevel,
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  },
});

const ONE_HOUR_MS = 60 * 60 * 1000;
setInterval(() => {
  const removed = cleanupMessages();
  if (removed > 0) app.log.info({ removed }, "очистка доставленных/просроченных сообщений");
}, ONE_HOUR_MS).unref();

// Файлы до 25 МБ идут как base64 внутри base64 (сырые байты -> JSON-конверт ->
// AEAD-шифротекст -> сам base64 на провод) — конечный размер пакета может
// доходить до ~45 МБ, дефолтный лимит `ws` (100 МБ) и так хватает, но задаём
// явно, чтобы не зависеть молча от чужого дефолта.
await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 * 1024 } });

app.get("/healthz", async () => ({ status: "ok", connectedDevices: connectedDeviceCount() }));

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    handleConnection(socket, instance.log);
  });
});

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
