FROM node:13.14.0-buster as build
WORKDIR /app
COPY . .
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm install
RUN npm run build
RUN npm prune --production

### Fetch stacks-node binary
FROM everpeace/curl-jq as stacks-node-build
ENV ARTIFACTS "http://blockstack-stacks-blockchain_artifacts.storage.googleapis.com/index.json"
RUN curl -s "$ARTIFACTS" --output ./artifacts-resp.json \
  && cat ./artifacts-resp.json | jq -r '."stacks-node"."linux-x64-test".latest.url' > ./url \
  && mkdir -p /app \
  && echo "Fetching $(cat ./url)" \
  && curl --compressed $(cat ./url) --output /stacks-node \
  && chmod +x /stacks-node

FROM ubuntu:focal

ENV SHELL /bin/bash

RUN apt-get update

### Install utils
RUN apt-get install -y sudo curl

### Set noninteractive apt-get
RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections

## apt-get clear cache
# RUN apt-get clean && rm -rf /var/cache/apt/* /var/lib/apt/lists/* /tmp/*

### stacky user ###
# '-l': see https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#user
RUN useradd -l -u 33333 -G sudo -md /home/stacky -s /bin/bash -p stacky stacky \
    # passwordless sudo for users in the 'sudo' group
    && sed -i.bkp -e 's/%sudo\s\+ALL=(ALL\(:ALL\)\?)\s\+ALL/%sudo ALL=NOPASSWD:ALL/g' /etc/sudoers
ENV HOME=/home/stacky
WORKDIR $HOME
# custom Bash prompt
# RUN { echo && echo "PS1='\[\e]0;\u \w\a\]\[\033[01;32m\]\u\[\033[00m\] \[\033[01;34m\]\w\[\033[00m\] \\\$ '" ; } >> .bashrc

### stacky user (2) ###
USER stacky
RUN sudo chown -R stacky:stacky $HOME
# use sudo so that user does not get sudo usage info on (the first) login
RUN sudo echo "Running 'sudo' for stacky: success" && \
  # create .bashrc.d folder and source it in the bashrc
  mkdir /home/stacky/.bashrc.d
  # && \
  # (echo; echo "for i in \$(ls \$HOME/.bashrc.d/*); do source \$i; done"; echo) >> /home/stacky/.bashrc

### Node.js
ENV NODE_VERSION=13.14.0
RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.3/install.sh | bash \
    && bash -c ". .nvm/nvm.sh \
        && nvm install $NODE_VERSION \
        && nvm alias default $NODE_VERSION"
ENV PATH=$PATH:/home/stacky/.nvm/versions/node/v${NODE_VERSION}/bin
RUN node -e 'console.log("Node.js runs")'

### Setup stacks-node
COPY --from=stacks-node-build /stacks-node stacks-node

### Setup stacks-blockchain-api
COPY --from=build /app stacks-blockchain-api
RUN sudo chown -Rh stacky:stacky stacks-blockchain-api
RUN printf '#!/bin/bash\ncd $(dirname $0)\nnpm run start\n' > stacks-blockchain-api/start \
  && chmod +x stacks-blockchain-api/start


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
ENV DATABASE_URL="postgresql://stacky@localhost"
ENV PGHOSTADDR="127.0.0.1"
ENV PGDATABASE="postgres"

# This is a bit of a hack. At the moment we have no means of starting background
# tasks from a Dockerfile. This workaround checks, on each bashrc eval, if the
# PostgreSQL server is running, and if not starts it.
RUN printf "\n# Auto-start PostgreSQL server.\n[[ \$(pg_ctl status | grep PID) ]] || pg_start > /dev/null\n" >> ~/.bashrc



