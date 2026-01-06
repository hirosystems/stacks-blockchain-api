FROM node:22-bookworm-slim

WORKDIR /app
COPY . .

RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm ci --no-audit && npm run build && npm run build:docs && npm prune --production

CMD ["node", "./lib/index.js"]
