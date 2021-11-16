FROM everpeace/curl-jq as build

RUN mkdir -p /bin

ENV ROSETTA_CLI_VERSION "0.5.10"

RUN curl -L --output rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  https://github.com/coinbase/rosetta-cli/releases/download/v${ROSETTA_CLI_VERSION}/rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  && tar xzf rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64.tar.gz \
  && mv rosetta-cli-${ROSETTA_CLI_VERSION}-linux-amd64 /bin/rosetta-cli \
  && chmod +x /bin/rosetta-cli

FROM debian:stretch

RUN mkdir -p /bin /app

COPY --from=build /bin/rosetta-cli /bin/

COPY docker/docker-entrypoint.sh /bin
RUN chmod +x /bin/docker-entrypoint.sh

COPY . /app

WORKDIR /app

ENTRYPOINT ["/bin/docker-entrypoint.sh"]

# CMD ["/bin/rosetta-cli", "--configuration-file /app/rosetta-config-docker.json", "view:networks"]
