FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY dist ./dist
RUN useradd --uid 10001 --create-home codexmate && mkdir /data && chown codexmate /data
USER codexmate
ENV CODEXMATE_HOME=/data
EXPOSE 4320
CMD ["node", "dist/cli/index.js", "coordinator", "--config", "/config/coordinator.json", "--host", "0.0.0.0"]
