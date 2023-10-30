# Running with `SEED_CHAINSTATE=true` will require the container to be launched with `--shm-size=xxxxMB` where at least 256MB is recommended
ARG STACKS_API_VERSION=v7.1.10
ARG STACKS_BLOCKCHAIN_VERSION=2.3.0.0.2
ARG PG_VERSION=15
ARG STACKS_NETWORK=mainnet
ARG PG_HOST=127.0.0.1
ARG PG_PORT=5432
ARG PG_USER=postgres
ARG PG_PASSWORD=postgres
ARG SEED_CHAINSTATE=false
ARG ARCHIVE_VERSION=latest

#######################################################################
## Build the stacks-blockchain-api
FROM node:18-buster as stacks-blockchain-api-build
ARG STACKS_API_VERSION
ENV STACKS_API_REPO=hirosystems/stacks-blockchain-api
ENV STACKS_API_VERSION=${STACKS_API_VERSION}
ENV DEBIAN_FRONTEND noninteractive
WORKDIR /app
RUN apt-get update -y \
    && apt-get install -y \
        curl \
        jq \
        openjdk-11-jre-headless \
        cmake \
    && git clone -b ${STACKS_API_VERSION} https://github.com/${STACKS_API_REPO} . \
    && echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env \
    && npm ci \
    && npm run build \
    && npm prune --production

#######################################################################
## Build the stacks-blockchain
FROM rust:buster as stacks-blockchain-build
ARG STACKS_BLOCKCHAIN_VERSION
ENV STACKS_NODE_REPO=stacks-network/stacks-blockchain
ENV STACKS_BLOCKCHAIN_VERSION=${STACKS_BLOCKCHAIN_VERSION}
ENV DEBIAN_FRONTEND noninteractive
WORKDIR /src
RUN apt-get update -y \
    && apt-get install -y \
        curl \
    && mkdir -p /out \
    && git clone -b ${STACKS_BLOCKCHAIN_VERSION} --depth 1 https://github.com/${STACKS_NODE_REPO} . \
    && cd testnet/stacks-node \
    && cargo build --features monitoring_prom,slog_json --release \
    && cp /src/target/release/stacks-node /out

#######################################################################
## Build the final image with all components from build stages
FROM debian:buster
ARG STACKS_NETWORK
ARG PG_HOST
ARG PG_PORT
ARG PG_USER
ARG PG_PASSWORD
ARG PG_VERSION
ARG SEED_CHAINSTATE
ARG STACKS_API_VERSION
ARG STACKS_BLOCKCHAIN_VERSION
ARG ARCHIVE_VERSION
ENV SEED_CHAINSTATE=${SEED_CHAINSTATE}
ENV STACKS_API_VERSION=${STACKS_API_VERSION}
ENV STACKS_BLOCKCHAIN_VERSION=${STACKS_BLOCKCHAIN_VERSION}
ENV PG_VERSION=${PG_VERSION}
ENV PG_HOST=${PG_HOST}
ENV PG_PORT=${PG_PORT}
ENV PG_USER=${PG_USER}
ENV PG_PASSWORD=${PG_PASSWORD}
ENV PG_DATABASE=stacks_blockchain_api
ENV PGDATA=/postgres
ENV PG_SCHEMA=stacks_blockchain_api
ENV STACKS_BLOCKCHAIN_DIR=/stacks-blockchain
ENV STACKS_BLOCKCHAIN_API_DIR=/stacks-blockchain-api
ENV STACKS_NETWORK=${STACKS_NETWORK}
ENV STACKS_CORE_EVENT_PORT=3700
ENV STACKS_CORE_EVENT_HOST=127.0.0.1
ENV STACKS_EVENT_OBSERVER=127.0.0.1:3700
ENV STACKS_BLOCKCHAIN_API_PORT=3999
ENV STACKS_BLOCKCHAIN_API_HOST=0.0.0.0
ENV STACKS_CORE_RPC_HOST=127.0.0.1
ENV STACKS_CORE_RPC_PORT=20443
ENV STACKS_CORE_P2P_PORT=20444
ENV ARCHIVE_VERSION=${ARCHIVE_VERSION}
ENV LANG en_US.UTF-8  
ENV LANGUAGE en_US:en  
ENV LC_ALL en_US.UTF-8
ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update \
    && apt-get install -y \
        gnupg2 \
        lsb-release \
        curl \
        jq \
        procps \
        netcat \
        gosu \
        locales
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

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
        ${STACKS_BLOCKCHAIN_DIR}/data \
        /scripts \
    && apt-get clean \
    && rm -rf /var/cache/apt/* /var/lib/apt/lists/* /tmp/*
COPY --from=stacks-blockchain-build /out ${STACKS_BLOCKCHAIN_DIR}
COPY --from=stacks-blockchain-api-build /app ${STACKS_BLOCKCHAIN_API_DIR}
COPY --from=stacks-blockchain-build /src/testnet/stacks-node/conf/*follower-conf.toml ${STACKS_BLOCKCHAIN_DIR}/

###################################
## entrypoint.sh
RUN <<EOF
cat > /entrypoint.sh <<'EOM'
#!/bin/bash -e
exec 2>&1
# enable json logging for stacks-blockchain
export STACKS_LOG_JSON=1
# configure postgres and start it
mkdir -p "${PGDATA}" || exit 1
chown -R postgres:postgres "${PGDATA}" || exit 1
gosu postgres /usr/lib/postgresql/${PG_VERSION}/bin/initdb -D "${PGDATA}" --wal-segsize=512  || exit 1
echo "host all all all trust" >> "$PGDATA/pg_hba.conf" || exit 1
gosu postgres /usr/lib/postgresql/${PG_VERSION}/bin/pg_ctl start -w -D ${PGDATA} -o "-c listen_addresses='*'" || exit 1

# download archive files if flag is true
if [ "${SEED_CHAINSTATE}" = "true" ]; then
    /scripts/seed-chainstate.sh || exit 1
fi
# create DB/schema if using other than default 'postgres'
if [[ "${SEED_CHAINSTATE}" = "false" && "${PG_DATABASE}" != "postgres" ]]; then
    /scripts/postgres-initdb.sh || exit 1
fi
# set chain_id based on network
case "${STACKS_NETWORK}" in
    testnet)
        export STACKS_CHAIN_ID=0x80000000
        ;;
    *)
        export STACKS_CHAIN_ID=0x00000001
        ;;
esac
# start stacks-blockchain and store pid
${STACKS_BLOCKCHAIN_DIR}/stacks-node start --config=${STACKS_BLOCKCHAIN_DIR}/${STACKS_NETWORK}-follower-conf.toml 2>&1 &
STACKS_BLOCKCHAIN_PID=$!

# start stacks-blockchain-api and store pid
pushd /stacks-blockchain-api
node ./lib/index.js 2>&1 &
STACKS_API_PID=$!

# try to stop processes gracefully
function cleanup() {
    echo "Exiting, signal: $1"
    kill $STACKS_PID 2>/dev/null && echo "stacks-blockchain exiting.."
    wait $STACKS_PID 2>/dev/null && echo "stacks-blockchain exited"
    kill $API_PID 2>/dev/null && echo "stacks-blockchain-api exiting.."
    wait $API_PID 2>/dev/null && echo "stacks-blockchain-api exited"
    echo "Postgres exiting.."
    gosu postgres /usr/lib/postgresql/${PG_VERSION}/bin/pg_ctl stop -W -D "$PGDATA" 2>/dev/null && echo "Postgres exited"
}
trap "cleanup SIGTERM" SIGTERM
trap "cleanup SIGINT" SIGINT
trap "cleanup SIGHUP" SIGHUP
trap "cleanup EXIT" EXIT
wait
EOM
chmod +x /entrypoint.sh
EOF

###################################
## /scripts/postgres-initdb.sh
RUN <<EOF
cat > /scripts/postgres-initdb.sh <<'EOM'
#!/bin/bash -e
# connect to postgres and create DB/schema as defined in env vars
psql -v ON_ERROR_STOP=1 --username "${PG_USER}" --dbname "template1" <<-EOSQL
    SELECT 'CREATE DATABASE ${PG_DATABASE}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PG_DATABASE}')\gexec
    \c ${PG_DATABASE};
    CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA};
	GRANT ALL PRIVILEGES ON DATABASE ${PG_DATABASE} TO ${PG_USER};
EOSQL
exit 0
EOM
chmod +x /scripts/postgres-initdb.sh
EOF

###################################
## /scripts/seed-chainstate.sh
RUN <<EOF
cat > /scripts/seed-chainstate.sh <<'EOM'
#!/bin/bash -e
exec 2>&1
echo "Seeding chainstate from https://archive.hiro.so"
# remove the "v" in front of the API version since the archive files do not use this naming structure
LOCAL_STACKS_API_VERSION=$(echo "${STACKS_API_VERSION:1}")

# define URL's to download 
PGDUMP_URL="https://archive.hiro.so/${STACKS_NETWORK}/stacks-blockchain-api-pg/stacks-blockchain-api-pg-${PG_VERSION}-${LOCAL_STACKS_API_VERSION}-${ARCHIVE_VERSION}.dump"
PGDUMP_URL_SHA256="https://archive.hiro.so/${STACKS_NETWORK}/stacks-blockchain-api-pg/stacks-blockchain-api-pg-${PG_VERSION}-${LOCAL_STACKS_API_VERSION}-${ARCHIVE_VERSION}.sha256"
CHAINDATA_URL="https://archive.hiro.so/${STACKS_NETWORK}/stacks-blockchain/${STACKS_NETWORK}-stacks-blockchain-${STACKS_BLOCKCHAIN_VERSION}-${ARCHIVE_VERSION}.tar.gz"
CHAINDATA_URL_SHA256="https://archive.hiro.so/${STACKS_NETWORK}/stacks-blockchain/${STACKS_NETWORK}-stacks-blockchain-${STACKS_BLOCKCHAIN_VERSION}-${ARCHIVE_VERSION}.sha256"

# define local storage locations
PGDUMP_DEST="/tmp/stacks-blockchain-api-pg-${PG_VERSION}-${LOCAL_STACKS_API_VERSION}-${ARCHIVE_VERSION}.dump"
PGDUMP_DEST_SHA256="/tmp/stacks-blockchain-api-pg-${PG_VERSION}-${LOCAL_STACKS_API_VERSION}-${ARCHIVE_VERSION}.sha256"
CHAINDATA_DEST="/tmp/${STACKS_NETWORK}-stacks-blockchain-${STACKS_BLOCKCHAIN_VERSION}-${ARCHIVE_VERSION}.tar.gz"
CHAINDATA_DEST_SHA256="/tmp/${STACKS_NETWORK}-stacks-blockchain-${STACKS_BLOCKCHAIN_VERSION}-${ARCHIVE_VERSION}.sha256"

exit_error() {
    echo "${1}"
    exit 1
}

download_file(){
    # download the archive file if it exists. if not, exit with error
    local url=${1}
    local dest=${2}
    # retrieve http code of archive file
    local http_code=$(curl --output /dev/null --silent --head -w "%{http_code}" ${url})
    # if file does noe exist, exit
    if [[ "${http_code}" && "${http_code}" != "200" ]];then
        exit_error "Error ${url} not found"
    fi
    echo "Downloading ${url} data to: ${dest}"
    curl -L -# ${url} -o "${dest}" || exit_error "Error downloading ${url} to ${dest}"
    return 0
}

verify_checksum(){
    # compares local sha256sum with downloaded sha256sum file
    local local_file=${1}
    local local_sha256=${2}
    local sha256=$(cat ${local_sha256} | awk {'print $1'} )
    local basename=$(basename ${local_file})
    local sha256sum=$(sha256sum ${local_file} | awk {'print $1'})
    # if sha256sum does not match file, exit
    if [ "${sha256}" != "${sha256sum}" ]; then
        exit_error "Error sha256 mismatch for ${basename}"
    fi
    return 0
}

# download the pg_dump archive and verify the sha256sum matches
download_file ${PGDUMP_URL} ${PGDUMP_DEST}
download_file ${PGDUMP_URL_SHA256} ${PGDUMP_DEST_SHA256}
verify_checksum ${PGDUMP_DEST} ${PGDUMP_DEST_SHA256}

# download the chainstate archive and verify the sha256sum matches
download_file ${CHAINDATA_URL} ${CHAINDATA_DEST}
download_file ${CHAINDATA_URL_SHA256} ${CHAINDATA_DEST_SHA256}
verify_checksum ${CHAINDATA_DEST} ${CHAINDATA_DEST_SHA256}

# restore the pg_dump
psql -U ${PG_USER} -c "alter user ${PG_USER} set max_parallel_workers_per_gather=0;" || exit_error "error altering user"
pg_restore --username ${PG_USER} --verbose --create --dbname postgres ${PGDUMP_DEST} || exit_error "Error restoring API pg_dump data"
psql -U ${PG_USER} -c "ALTER USER ${PG_USER} PASSWORD '${PG_PASSWORD}';" || exit_error "Error setting PG_USER password"
psql -U ${PG_USER} -c "GRANT ALL PRIVILEGES ON DATABASE $PG_DATABASE TO $PG_USER;" || exit_error "error granting PG_USER privileges"

# update stacks-blockchain config to use extracted data, then extract it 
sed -i -e "s|^# working_dir.*|working_dir = \"${STACKS_BLOCKCHAIN_DIR}/data\"|;"  ${STACKS_BLOCKCHAIN_DIR}/${STACKS_NETWORK}-follower-conf.toml || exit_error "error updating stacks-blockchain config"
echo "Extracting stacks-blockchain chainstate data to: ${STACKS_BLOCKCHAIN_DIR}/data"
tar -xvf "${CHAINDATA_DEST}" -C "${STACKS_BLOCKCHAIN_DIR}/data" || exit_error "Error extracting stacks-blockchain chainstate data"

# remove downloaded files to reduce disk usage
if [ -f ${PGDUMP_DEST} ]; then
  rm -f ${PGDUMP_DEST} || exit_error "Error removing ${PGDUMP_DEST}"
fi
if [ -f ${PGDUMP_DEST_SHA256} ]; then
  rm -f ${PGDUMP_DEST_SHA256} || exit_error "Error removing ${PGDUMP_DEST_SHA256}"
fi
if [ -f ${CHAINDATA_DEST} ]; then
  rm -f ${CHAINDATA_DEST} || exit_error "Error removing ${CHAINDATA_DEST}"
fi
if [ -f ${CHAINDATA_DEST_SHA256} ]; then
  rm -f ${CHAINDATA_DEST_SHA256} || exit_error "Error removing ${CHAINDATA_DEST_SHA256}"
fi
exit 0
EOM
chmod +x /scripts/seed-chainstate.sh
EOF



EXPOSE ${STACKS_BLOCKCHAIN_API_PORT} ${STACKS_CORE_RPC_PORT} ${STACKS_CORE_P2P_PORT}
VOLUME /data
CMD ["/entrypoint.sh"]

