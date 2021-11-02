# Testing the Rosetta APIs

Build and run the `stx-rosetta.Dockerfile` image:

    docker build -t stx-rosetta:stable -f stx-rosetta.Dockerfile .
    docker run -d -p 3999:3999 --mount source=rosetta-data,target=/data \
        --name stx-rosetta stx-rosetta:stable

By default, this will connect to the testnet.  To run a local node, run


    docker run -d -p 3999:3999 --mount source=rosetta-data,target=/data \
        --name stx-rosetta -e STACKS_NETWORK=mocknet stx-rosetta:stable

Use a recent version of [rosetta-cli](https://github.com/coinbase/rosetta-cli) to test the endpoints:

    rosetta-cli --configuration-file rosetta-cli-config/rosetta-config.json \
        view:block 1

    rosetta-cli --configuration-file rosetta-cli-config/rosetta-config.json \
        check:data

`rosetta-cli` will sync with the blockchain until it reaches the tip,
and then exit, displaying the test results.

At present, account reconciliation is disabled; proper testing of that
requires token transfer transactions while `rosetta-cli` is running.

Documentation for the Rosetta APIs can be found at

https://hirosystems.github.io/stacks-blockchain-api/
