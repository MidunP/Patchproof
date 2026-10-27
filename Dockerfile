FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# dist/ already contains compiled JS + dashboard, landing, schema.sql (via copy-assets.js)
COPY --from=builder /app/dist ./dist
# Seeds must be present at runtime so demo runs can load them
COPY seeds ./seeds

EXPOSE 3000
CMD ["node", "dist/index.js"]
