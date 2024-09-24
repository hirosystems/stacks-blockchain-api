FROM --platform=$BUILDPLATFORM rust:1.68-alpine as clarinet-builder

ARG CLARINET_VERSION=v2.8.0
WORKDIR /usr/src/

RUN apk add --no-cache \
    git \
    build-base \
    curl \
    pkgconfig

# Build Clarinet from source
RUN git clone https://github.com/hirosystems/clarinet.git && \
    cd clarinet && \
    git checkout 1bdc272 && \
    cargo build --release

FROM --platform=$BUILDPLATFORM docker:dind

RUN apk add --no-cache \
    ca-certificates \
    docker \
    sudo \
    net-tools \
    file \
    iproute2 \
    shadow

# Add root to the docker group
RUN usermod -aG docker root

# Copy Clarinet binary from builder image
COPY --from=clarinet-builder /usr/src/clarinet/target/release/clarinet /usr/local/bin/clarinet

WORKDIR /app

VOLUME /chainstate

# Stacks API
EXPOSE 3700
# Stacks-node RPC
EXPOSE 20443
# Bitcoind JSON-RPC
EXPOSE 18443
# Postgres
EXPOSE 5490

# Copy Clarinet config files
COPY Clarinet.toml .
COPY settings/Devnet.toml ./settings/
COPY start.sh .

RUN chmod +x start.sh

# Start the Docker daemon and the devnet
CMD ["/app/start.sh"]
