FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci

COPY backend backend/
WORKDIR /app/backend
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --omit=dev

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma

# Copy prisma client specifically
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma

WORKDIR /app/backend

EXPOSE 3000

CMD ["sh", "-c", "npx --yes prisma migrate deploy && node dist/src/server.js"]
