# AllMansSky — static WebGL game, no build step, no runtime dependencies.
# The image is just Node + the game files + the tiny static server.
FROM node:22-alpine

WORKDIR /app

COPY server.mjs index.html ./
COPY src ./src
COPY vendor ./vendor

ENV NODE_ENV=production
EXPOSE 8087

CMD ["node", "server.mjs"]
