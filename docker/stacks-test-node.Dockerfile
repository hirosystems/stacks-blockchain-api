# syntax=docker/dockerfile:1

FROM debian:bullseye-slim

ARG TARGETPLATFORM

# Use pre-build binaries from context directory
COPY *stacks-blockchain-binaries /stacks-blockchain-binaries

SHELL ["/bin/bash", "-ce"]
RUN <<EOF
  STACKS_NODE_BIN_ARM64=/stacks-blockchain-binaries/aarch64-unknown-linux-gnu/stacks-node
  STACKS_NODE_BIN_AMD64=/stacks-blockchain-binaries/x86_64-unknown-linux-gnu/stacks-node
  if [ "$TARGETPLATFORM" = "linux/arm64" ] && [ -f "$STACKS_NODE_BIN_ARM64" ]; then
    echo "Using existing stacks-node binary: $STACKS_NODE_BIN_ARM64"
    mkdir -p target/release && mv "$STACKS_NODE_BIN_ARM64" /usr/bin/stacks-node
    exit 0
  elif [ "$TARGETPLATFORM" = "linux/amd64" ] && [ -f "$STACKS_NODE_BIN_AMD64" ]; then
    echo "Using existing stacks-node binary: $STACKS_NODE_BIN_AMD64"
    mkdir -p target/release && mv "$STACKS_NODE_BIN_AMD64" /usr/bin/stacks-node
    exit 0
  else
    echo "No stacks-node binary available for $TARGETPLATFORM"
    exit 1
  fi
  rm -rf /stacks-blockchain-binaries
EOF

CMD ["/usr/bin/stacks-node"]
