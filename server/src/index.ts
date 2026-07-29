import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
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

await app.register(fastifyWebsocket);

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
