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

# export BLOCKSTACK_DEBUG="1"
export STACKS_EVENT_OBSERVER="127.0.0.1:3700"
export BLOCKSTACK_USE_TEST_GENESIS_CHAINSTATE="1"

cargo run --manifest-path /Users/matt/Projects/stacks-blockchain2/testnet/stacks-node/Cargo.toml -- \
start --config=/Users/matt/Projects/stacks-blockchain-api2/stacks-blockchain/Stacks-krypton.toml &

wait $!
