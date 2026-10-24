# node:22-bookworm-slim publica linux/amd64 e linux/arm64.
# Na VM Oracle (aarch64), o build local gera a imagem arm64.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3333
ENV MCP_PATH=/mcp

EXPOSE 3333

CMD ["node", "dist/mcp/http.js"]
