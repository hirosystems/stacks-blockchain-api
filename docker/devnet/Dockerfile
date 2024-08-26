FROM --platform=$BUILDPLATFORM rust:1.68-alpine as builder

ARG CLARINET_VERSION=v2.8.0
WORKDIR /usr/src/clarinet

RUN apk add --no-cache \
    git \
    build-base \
    curl \
    pkgconfig

# building from source because I wasn't able to get the platform working from binary
RUN git clone https://github.com/hirosystems/clarinet.git && \
    cd clarinet && \
    git checkout main && \
    cargo build --release

# Final stage (using Docker-in-Docker)
FROM --platform=$BUILDPLATFORM docker:dind

# Install necessary packages
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

# Copy Clarinet binary from builder stage
COPY --from=builder /usr/src/clarinet/clarinet/target/release/clarinet /usr/local/bin/clarinet

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
EXPOSE 5432

# Copy Clarinet config files
COPY Clarinet.toml .
COPY settings/Devnet.toml ./settings/
COPY start.sh .

RUN chmod +x start.sh

# Start the Docker daemon and the devnet
CMD ["sh", "-c", "dockerd-entrypoint.sh && /app/start.sh"]
