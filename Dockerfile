FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

RUN npm prune --production

# ============================================================

FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tzdata openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma

COPY public ./public

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production
ENV PORT=3000

VOLUME ["/app/data", "/app/logs", "/app/game-data"]

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
