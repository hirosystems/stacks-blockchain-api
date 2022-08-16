#!/bin/bash

script_name=${0##*/}

function kill_existing {
  echo "Killing $script_name"
  pkill -f "$script_name"
}

if [ "$1" = "kill" ]; then
  kill_existing
  exit 0
fi

if pgrep -f "$script_name" >/dev/null; then
  echo "Already running, restarting..."
  kill_existing
fi

function cleanup {
  echo "Exiting stacks-node"
  trap - SIGTERM && kill 0
}

trap cleanup SIGINT SIGTERM EXIT

rm -rf "/Users/matt/Projects/stacks-blockchain-api2/stacks-blockchain/.chaindata"

echo "Starting stacks-node"

/Users/matt/Projects/stacks-blockchain/target/debug/stacks-node start --config=/Users/matt/Projects/stacks-blockchain-api2/stacks-blockchain/Stacks-mocknet-2.1.toml &

wait $!
