# Стадия сборки: нужны python3/make/g++ на случай, если для better-sqlite3
# не найдётся готовый прекомпилированный бинарник под платформу VPS.
FROM node:20-bookworm AS builder
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
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY package.json ./

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
