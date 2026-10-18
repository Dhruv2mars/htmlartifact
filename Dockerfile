FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun build bin/htmlartifact.js --target=node --format=esm --outfile=dist/htmlartifact.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /data/artifacts && chown node:node /data/artifacts
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
