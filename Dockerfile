# Margin: two stages on Node 26. The runtime has no node_modules (the server has no runtime deps).

FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=5555
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY src/cli ./src/cli
COPY --from=build /app/dist/public ./dist/public
COPY bin/margin-user /usr/local/bin/margin-user
EXPOSE 5555
CMD ["node", "src/server/main.ts"]
