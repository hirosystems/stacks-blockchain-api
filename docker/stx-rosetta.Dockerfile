ARG STACKS_API_VERSION=6.2.2
ARG STACKS_NODE_VERSION=2.05.0.4.0
ARG STACKS_API_REPO=hirosystems/stacks-blockchain-api
ARG STACKS_NODE_REPO=stacks-network/stacks-blockchain
ARG PG_VERSION=14
ARG STACKS_NETWORK=mainnet
ARG STACKS_LOG_DIR=/var/log/stacks-node
ARG STACKS_SVC_DIR=/etc/service
ARG STACKS_BLOCKCHAIN_DIR=/stacks-blockchain
ARG STACKS_BLOCKCHAIN_API_DIR=/stacks-blockchain-api
ARG V2_POX_MIN_AMOUNT_USTX=90000000260
ARG PG_DATA=/data/postgres
ARG PG_DATABASE=postgres
ARG PG_HOST=127.0.0.1
ARG PG_PORT=5432
ARG PG_USER=postgres
ARG PG_PASSWORD=postgres

#######################################################################
## Build the stacks-blockchain-api
FROM node:lts-buster as stacks-blockchain-api-build
ARG STACKS_API_REPO
ARG STACKS_API_VERSION
ENV STACKS_API_REPO=${STACKS_API_REPO}
ENV STACKS_API_VERSION=${STACKS_API_VERSION}
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y \
        curl \
        jq \
        openjdk-11-jre-headless \
        cmake \
    && git clone -b ${STACKS_API_VERSION} https://github.com/${STACKS_API_REPO} . \
    && echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env \
    && npm config set unsafe-perm true \
    && npm ci \
    && npm run build \
    && npm prune --production

#######################################################################
## Build the stacks-blockchain
FROM rust:buster as stacks-blockchain-build
ARG STACKS_NODE_REPO
ARG STACKS_NODE_VERSION
ENV STACKS_NODE_REPO=${STACKS_NODE_REPO}
ENV STACKS_NODE_VERSION=${STACKS_NODE_VERSION}
WORKDIR /src
RUN apt-get update -y \
    && apt-get install -y \
        curl \
        jq \
    && mkdir -p /out \
    && git clone -b ${STACKS_NODE_VERSION} --depth 1 https://github.com/${STACKS_NODE_REPO} . \
    && cd testnet/stacks-node \
    && cargo build --features monitoring_prom,slog_json --release \
    && cp /src/target/release/stacks-node /out

#######################################################################
## Build the final image with all components from build stages
FROM debian:buster
ARG STACKS_NETWORK
ARG STACKS_LOG_DIR
ARG STACKS_SVC_DIR
ARG STACKS_BLOCKCHAIN_DIR
ARG STACKS_BLOCKCHAIN_API_DIR
ARG PG_DATA
ARG PG_VERSION
ARG V2_POX_MIN_AMOUNT_USTX
ARG PG_HOST
ARG PG_PORT
ARG PG_USER
ARG PG_PASSWORD
ARG PG_DATABASE
ENV PG_HOST=${PG_HOST}
ENV PG_PORT=${PG_PORT}
ENV PG_USER=${PG_USER}
ENV PG_PASSWORD=${PG_PASSWORD}
ENV PG_DATABASE=${PG_DATABASE}
ENV PG_DATA=${PG_DATA}
ENV STACKS_SVC_DIR=${STACKS_SVC_DIR}
ENV STACKS_BLOCKCHAIN_DIR=${STACKS_BLOCKCHAIN_DIR}
ENV STACKS_BLOCKCHAIN_API_DIR=${STACKS_BLOCKCHAIN_API_DIR}
ENV STACKS_NETWORK=${STACKS_NETWORK}
ENV STACKS_LOG_DIR=${STACKS_LOG_DIR}
ENV STACKS_CORE_EVENT_PORT=3700
ENV STACKS_CORE_EVENT_HOST=127.0.0.1
ENV STACKS_EVENT_OBSERVER=127.0.0.1:3700
ENV STACKS_BLOCKCHAIN_API_PORT=3999
ENV STACKS_BLOCKCHAIN_API_HOST=0.0.0.0
ENV STACKS_CORE_RPC_HOST=127.0.0.1
ENV STACKS_CORE_RPC_PORT=20443
ENV STACKS_CORE_P2P_PORT=20444
ENV MAINNET_STACKS_CHAIN_ID=0x00000001
ENV TESTNET_STACKS_CHAIN_ID=0x80000000
ENV V2_POX_MIN_AMOUNT_USTX=${V2_POX_MIN_AMOUNT_USTX}
RUN apt-get update \
    && apt install -y \
        gnupg2 \
        lsb-release \
        curl procps \
        netcat \
        gosu \
        runit-init \
        rsyslog
RUN curl -sL https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" > /etc/apt/sources.list.d/pgsql.list \
    && curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get update \
    && apt-get install -y \
        postgresql-${PG_VERSION} \
        postgresql-client-${PG_VERSION} \
        nodejs \
    && echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections
RUN mkdir -p \
        ${STACKS_SVC_DIR}/postgresql/log \
        ${STACKS_SVC_DIR}/stacks-blockchain-api/log \
        ${STACKS_SVC_DIR}/stacks-blockchain \
        ${STACKS_LOG_DIR}/postgresql \
        ${STACKS_LOG_DIR}/stacks-blockchain-api/log \
    && apt-get clean \
    && rm -rf /var/cache/apt/* /var/lib/apt/lists/* /tmp/* ${STACKS_SVC_DIR}/getty*
COPY --from=stacks-blockchain-build /out ${STACKS_BLOCKCHAIN_DIR}
COPY --from=stacks-blockchain-api-build /app ${STACKS_BLOCKCHAIN_API_DIR}
COPY --from=stacks-blockchain-build /src/testnet/stacks-node/conf/*follower-conf.toml ${STACKS_BLOCKCHAIN_DIR}/

###################################
##  runit service files
RUN printf '#!/bin/sh\nexec 2>&1\n[ ! -d %s ] && mkdir -p %s && chown -R postgres:postgres %s && gosu postgres /usr/lib/postgresql/%s/bin/pg_ctl init -D %s\nexec gosu postgres /usr/lib/postgresql/%s/bin/postmaster -D %s' ${PG_DATA} ${PG_DATA} ${PG_DATA} ${PG_VERSION} ${PG_DATA} ${PG_VERSION} ${PG_DATA} > ${STACKS_SVC_DIR}/postgresql/run \
    && printf '#!/bin/sh\nrm -rf %s' ${PG_DATA} > ${STACKS_SVC_DIR}/postgresql/finish \
    && printf '#!/bin/sh\nexec svlogd -tt %s/postgresql' ${STACKS_LOG_DIR} > ${STACKS_SVC_DIR}/postgresql/log/run \
    && printf '#!/bin/sh\nexec 2>&1\ncase $STACKS_NETWORK in\n    testnet)\n        exec %s/stacks-node start --config=%s/testnet-follower-conf.toml 2>&1\n        ;;\n    mocknet)\n        exec %s/stacks-node start --config=%s/mocknet-follower-conf.toml 2>&1\n        ;;\n    *)\n        exec %s/stacks-node start --config=%s/mainnet-follower-conf.toml 2>&1\n        ;;\nesac' ${STACKS_BLOCKCHAIN_DIR} ${STACKS_BLOCKCHAIN_DIR} ${STACKS_BLOCKCHAIN_DIR} ${STACKS_BLOCKCHAIN_DIR} ${STACKS_BLOCKCHAIN_DIR} ${STACKS_BLOCKCHAIN_DIR} > ${STACKS_SVC_DIR}/stacks-blockchain/run \
    && printf '#!/bin/bash\nexec 2>&1\nsv start postgresql stacks-blockchain || exit 1\nif [ $STACKS_NETWORK != "mainnet" ]; then\n    export STACKS_CHAIN_ID=%s\nelse\n    export STACKS_CHAIN_ID=%s\n    export V2_POX_MIN_AMOUNT_USTX=%s\nfi\ncd %s && exec node ./lib/index.js 2>&1' ${TESTNET_STACKS_CHAIN_ID} ${MAINNET_STACKS_CHAIN_ID} ${V2_POX_MIN_AMOUNT_USTX} ${STACKS_BLOCKCHAIN_API_DIR} > ${STACKS_SVC_DIR}/stacks-blockchain-api/run \
    && printf '#!/bin/sh\nexec svlogd -tt %s/stacks-blockchain-api' ${STACKS_LOG_DIR} > ${STACKS_SVC_DIR}/stacks-blockchain-api/log/run \
    && printf '#!/bin/sh\n/usr/bin/runsvdir %s' ${STACKS_SVC_DIR} > /entrypoint.sh \
    && chmod 755 \
        ${STACKS_SVC_DIR}/postgresql/run \
        ${STACKS_SVC_DIR}/postgresql/finish \
        ${STACKS_SVC_DIR}/postgresql/log/run \
        ${STACKS_SVC_DIR}/stacks-blockchain/run \
        ${STACKS_SVC_DIR}/stacks-blockchain-api/run \
        ${STACKS_SVC_DIR}/stacks-blockchain-api/log/run \
        /entrypoint.sh

EXPOSE ${STACKS_BLOCKCHAIN_API_PORT} ${STACKS_CORE_RPC_PORT} ${STACKS_CORE_P2P_PORT}
VOLUME /data
CMD ["/entrypoint.sh"]x
