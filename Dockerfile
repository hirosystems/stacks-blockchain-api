FROM node:24-bookworm-slim

WORKDIR /app
COPY . .

RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN npm ci --no-audit && npm run build && npm prune --production

CMD ["node", "./lib/index.js"]
