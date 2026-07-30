# Базовые образы задаются аргументами: Docker Hub периодически отвечает
# "429 Too Many Requests" на анонимные скачивания с облачных IP, и тогда сборку
# спасает зеркало, например mirror.gcr.io (см. docs/DEPLOY.md).
ARG NODE_IMAGE=node:20-bookworm
ARG NODE_SLIM_IMAGE=node:20-bookworm-slim

# Стадия сборки: нужны python3/make/g++ на случай, если для better-sqlite3
# не найдётся готовый прекомпилированный бинарник под платформу VPS.
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Ставим все зависимости, включая dev (tsx нужен и для сборки,
# и в рантайме — им же выполняется CLI generate-invite внутри контейнера).
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Финальный образ — тонкий, без компиляторов, но node_modules переносим целиком.
FROM ${NODE_SLIM_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY package.json ./

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
