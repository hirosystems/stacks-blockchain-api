FROM --platform=linux/amd64 everpeace/curl-jq as build

RUN mkdir -p /bin

ENV ROSETTA_CLI_VERSION "0.5.10"

RUN curl -L --output rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  https://github.com/coinbase/mesh-cli/releases/download/v${ROSETTA_CLI_VERSION}/rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  && tar xzf rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  && mv rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64 /bin/rosetta-cli \
  && chmod +x /bin/rosetta-cli

FROM --platform=linux/amd64 debian:stretch

RUN mkdir -p /bin /app

COPY --from=build /bin/rosetta-cli /bin/

COPY docker/start-construction.sh /bin/
RUN chmod +x /bin/start-construction.sh

COPY docker/start-data.sh /bin/
RUN chmod +x /bin/start-data.sh

COPY . /app

WORKDIR /app

# CMD ["/bin/rosetta-cli", "--configuration-file /app/rosetta-config-docker.json", "view:networks"]
