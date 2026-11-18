# Образ сервера синхронизации. Собирается из корня репозитория:
#   docker build -f server/Dockerfile -t planer-sync .
FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/server.js ./
COPY src/sync-core.js ./
ENV NODE_ENV=production DATA_DIR=/data PORT=8443
EXPOSE 8443
CMD ["node", "server.js"]
