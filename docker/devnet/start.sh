#!/bin/sh

set -x  # Enable debugging output

# Clean up existing network and containers
docker network rm devnet.devnet || true
docker rm -f $(docker ps -a -q --filter name=devnet.devnet) || true

# List existing networks and containers
echo "Existing networks:"
docker network ls
echo "Existing containers:"
docker ps -a


netstat -tuln | grep 18443
netstat -tuln | grep 18453

mkdir /app/.cache

# Start Clarinet devnet
/usr/local/bin/clarinet devnet start --no-dashboard --manifest-path /app/Clarinet.toml
