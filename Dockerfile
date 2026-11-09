FROM node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

WORKDIR /app
COPY . .

RUN apk add --no-cache git
RUN npm ci --no-audit && npm run build && npm prune --production

CMD ["node", "./lib/index.js"]
