#!/bin/sh

set -x  # Enable debugging output

sh -c dockerd-entrypoint.sh &

until [ -S /var/run/docker.sock ]; do
  echo "Waiting for Docker to start..."
  sleep 1
done
echo "starting clarinet devnet"
/usr/local/bin/clarinet devnet start --no-dashboard --manifest-path /app/Clarinet.toml
