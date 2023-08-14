FROM node:16-alpine

WORKDIR /app
COPY . .

RUN apk add --no-cache --virtual .build-deps alpine-sdk python3 git openjdk8-jre cmake
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm ci && npm run build && npm run build:docs && npm prune --production
RUN apk del .build-deps

# As no pre-built binaries of duckdb can be found for Alpine (musl based),
# a rebuild of duckdb package is need.
#
# Library used by the event-replay based on parquet files.
ARG DUCKDB_VERSION=0.8.1
WORKDIR /duckdb
RUN apk add --no-cache --virtual .duckdb-build-deps python3 git g++ make
RUN git clone https://github.com/duckdb/duckdb.git -b v${DUCKDB_VERSION} --depth 1 \
  && cd duckdb/tools/nodejs \
  && ./configure && make all
WORKDIR /app
RUN npm uninstall duckdb && npm install /duckdb/duckdb/tools/nodejs
RUN apk del .duckdb-build-deps

CMD ["node", "./lib/index.js"]
