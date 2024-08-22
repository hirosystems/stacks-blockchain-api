FROM --platform=$BUILDPLATFORM rust:1.68 as builder
# FROM --platform=linux/amd64 rust:1.68 as builder

ARG CLARINET_VERSION=v2.8.0
WORKDIR /usr/src/clarinet

RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# building from source because I wasn't able to get the platform working from binary
RUN git clone https://github.com/hirosystems/clarinet.git . && \
    git checkout main && \
    cargo build --release

# Final stage (using Docker-in-Docker)
# FROM --platform=linux/amd64 docker:dind
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
COPY --from=builder /usr/src/clarinet/target/release/clarinet /usr/local/bin/clarinet

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
CMD ["sh", "-c", "dockerd-entrypoint.sh && /app/start.sh"]
