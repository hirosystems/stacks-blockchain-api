#!/usr/bin/env bash
/bin/rosetta-cli --configuration-file /app/rosetta-config-docker.json check:construction
chmod -R 777 /app/rosetta-output
