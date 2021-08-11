### Build blockstack-core-sidecar API
FROM node:14-alpine as build
WORKDIR /app
COPY . .
RUN apk add --no-cache --virtual .build-deps alpine-sdk python git openjdk8-jre
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm install && npm run build && npm prune --production

### Fetch stacks-node binary
FROM blockstack/stacks-blockchain:2.0.11.2.0-stretch as stacks-node-build

### Begin building base image
FROM ubuntu:focal

SHELL ["/bin/bash", "-c"]

### Install utils
RUN apt-get update
RUN apt-get install -y sudo curl pslist

### Install nodejs
RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install -y nodejs

### Set noninteractive apt-get
RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections

### stacky user ###
# see https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#user
RUN useradd -l -u 33333 -G sudo -md /home/stacky -s /bin/bash -p stacky stacky \
    # passwordless sudo for users in the 'sudo' group
    && sed -i.bkp -e 's/%sudo\s\+ALL=(ALL\(:ALL\)\?)\s\+ALL/%sudo ALL=NOPASSWD:ALL/g' /etc/sudoers
ENV HOME=/home/stacky
WORKDIR $HOME
USER stacky
RUN sudo chown -R stacky:stacky $HOME
RUN mkdir /home/stacky/.bashrc.d

### Setup stacks-node
COPY --from=stacks-node-build /bin/stacks-node stacks-node/
ENV PATH="$PATH:$HOME/stacks-node"

#### Copy stacks-node mocknet config
COPY ./stacks-blockchain/Stacks-mocknet.toml ./

### Setup stacks-blockchain-api
COPY --from=build /app stacks-blockchain-api
RUN sudo chown -Rh stacky:stacky stacks-blockchain-api
RUN printf '#!/bin/bash\ncd $(dirname $0)\nnpm run start\n' > stacks-blockchain-api/stacks_api \
  && chmod +x stacks-blockchain-api/stacks_api
ENV PATH="$PATH:$HOME/stacks-blockchain-api"
EXPOSE 3999

### Install Postgres
RUN sudo apt-get install -y postgresql-12 postgresql-contrib-12

### Setup Postgres
# Borrowed from https://github.com/gitpod-io/workspace-images/blob/master/postgres/Dockerfile
ENV PATH="$PATH:/usr/lib/postgresql/12/bin"
ENV PGDATA="/home/stacky/.pgsql/data"
RUN mkdir -p ~/.pg_ctl/bin ~/.pg_ctl/sockets \
  && printf '#!/bin/bash\n[ ! -d $PGDATA ] && mkdir -p $PGDATA && initdb -D $PGDATA\npg_ctl -D $PGDATA -l ~/.pg_ctl/log -o "-k ~/.pg_ctl/sockets" start\n' > ~/.pg_ctl/bin/pg_start \
  && printf '#!/bin/bash\npg_ctl -D $PGDATA -l ~/.pg_ctl/log -o "-k ~/.pg_ctl/sockets" stop\n' > ~/.pg_ctl/bin/pg_stop \
  && chmod +x ~/.pg_ctl/bin/*
ENV PATH="$PATH:$HOME/.pg_ctl/bin"

### Clear caches
RUN sudo apt-get clean && sudo rm -rf /var/cache/apt/* /var/lib/apt/lists/* /tmp/*

### Setup service env vars
ENV PG_HOST=127.0.0.1
ENV PG_PORT=5432
ENV PG_USER=stacky
ENV PG_PASSWORD=postgres
ENV PG_DATABASE=postgres

ENV STACKS_CORE_EVENT_PORT=3700
ENV STACKS_CORE_EVENT_HOST=127.0.0.1

ENV STACKS_EVENT_OBSERVER=127.0.0.1:3700

ENV STACKS_BLOCKCHAIN_API_PORT=3999
ENV STACKS_BLOCKCHAIN_API_HOST=0.0.0.0

ENV STACKS_CORE_RPC_HOST=127.0.0.1
ENV STACKS_CORE_RPC_PORT=20443

### Startup script & coordinator
RUN printf '#!/bin/bash\n\
MAINNET_ID=0x00000001\n\
MOCKNET_ID=0x80000000\n\
[ $1 = "mocknet" ] && STACKS_CHAIN_ID="${MOCKNET_ID}" || STACKS_CHAIN_ID="${MAINNET_ID}"\n\
export STACKS_CHAIN_ID\n\
trap "exit" INT TERM\n\
trap "kill 0" EXIT\n\
echo Your container args are: "$@"\n\
tail --retry -F stacks-api.log stacks-node.log 2>&1 &\n\
while true\n\
do\n\
  pg_start\n\
  stacks_api &> stacks-api.log &\n\
  stacks_api_pid=$!\n\
  if [ $1 = "mocknet" ]; then\n\
    stacks-node start --config=/home/stacky/Stacks-mocknet.toml &> stacks-node.log &\n\
  else\n\
    stacks-node mainnet &> stacks-node.log &\n\
  fi\n\
  stacks_node_pid=$!\n\
  wait $stacks_node_pid\n\
  echo "node exit, restarting..."\n\
  rkill -9 $stacks_api_pid\n\
  pg_stop\n\
  rm -rf $PGDATA\n\
  sleep 5\n\
done\n\
' >> run.sh && chmod +x run.sh

ENTRYPOINT ["/home/stacky/run.sh"]

CMD ["/home/stacky/run.sh"]
