FROM node:20-bookworm-slim

WORKDIR /app
COPY . .
COPY --from=qldrsc/duckdb /usr/local/bin/duckdb /bin/duckdb

RUN apt-get update && \
    apt-get install -y git openjdk-17-jre && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm ci && npm run build && npm run build:docs && npm prune --production

CMD ["node", "./lib/index.js"]
