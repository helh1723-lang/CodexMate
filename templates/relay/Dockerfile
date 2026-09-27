FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME /data
CMD ["node", "dist/chat/cli.js", "relay", "--home", "/data", "--host", "0.0.0.0", "--port", "8787"]
