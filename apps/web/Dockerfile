# Build stage — uses the same Bun version you develop with.
FROM oven/bun:1.4-alpine AS build
WORKDIR /app

COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Runtime stage — adapter-node serves `build/index.js`.
FROM oven/bun:1.4-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD ["bun", "build/index.js"]
