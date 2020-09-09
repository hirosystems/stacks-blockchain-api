FROM node:lts


RUN mkdir -p bin

ARG ROSETTA_CLI_VERSION="0.5.0"

RUN wget -c https://github.com/coinbase/rosetta-cli/releases/download/v${ROSETTA_CLI_VERSION}/rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz 
RUN tar xzf rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz 
RUN mv rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64 bin/rosetta-cli 
RUN chmod +x bin/rosetta-cli

WORKDIR /app/blockstack
COPY package.json package.json
COPY docs docs
COPY client client


RUN npm install
COPY . .

COPY src/tests-rosetta-cli/Docker/docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh
ENTRYPOINT ["/bin/docker-entrypoint.sh"]

RUN chmod +x src/tests-rosetta-cli/rosetta-test.sh
CMD ./src/tests-rosetta-cli/rosetta-test.sh