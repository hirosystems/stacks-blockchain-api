---
Title: Rosetta support
---

# Rosetta Support

The Stacks Blockchain API supports [v1.4.6 of the Rosetta specification](https://www.rosetta-api.org/). This industry open standard makes it easy to integrate blockchain deployment and interaction.

# Testing the Rosetta APIs

To build and run the `rosetta.Dockerfile` image, run the following command:

```
docker build -t rosetta:stable -f rosetta.Dockerfile .
docker run -d \
  -p 3999:3999 \
  --mount source=rosetta-data,target=/data \
  --name rosetta \
rosetta:stable
```

To build and run the `rosetta.Dockerfile` image using an [archived chainstate](https://docs.hiro.so/references/hiro-archive#what-is-the-hiro-archive), run the following command:

```
docker build -t rosetta:stable -f rosetta.Dockerfile .
docker run -d \
  -p 3999:3999 \
  -e SEED_CHAINSTATE=true \
  --mount source=rosetta-data,target=/data \
  --name rosetta \
rosetta:stable
```


By default, this will connect to the mainnet. To run a local node, run the following command:

```
docker run -d \
  -p 3999:3999 \
  -e STACKS_NETWORK=mocknet \
  --mount source=rosetta-data,target=/data \
  --name rosetta \
rosetta:stable
```

To use a recent version of [rosetta-cli](https://github.com/coinbase/rosetta-cli) to test the endpoints, use the following command:
```
rosetta-cli \
  --configuration-file rosetta-cli-config/rosetta-config.json \
  view:block 1
rosetta-cli \
  --configuration-file rosetta-cli-config/rosetta-config.json \
  check:data
```

`rosetta-cli` will then sync with the blockchain until it reaches the tip, and then exit, displaying the test results.
Currently, account reconciliation is disabled; proper testing of that feature requires token transfer transactions while `rosetta-cli` is running.
Documentation for the Rosetta APIs can be found [here](https://hirosystems.github.io/stacks-blockchain-api/).
You may also review Data and Construction Rosetta endpoints [here](https://docs.hiro.so/api#tag/Rosetta)
