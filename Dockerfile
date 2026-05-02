FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

RUN npm prune --production

# ============================================================

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY public ./public

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production
ENV PORT=3000

VOLUME ["/app/data", "/app/logs", "/app/game-data"]

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
