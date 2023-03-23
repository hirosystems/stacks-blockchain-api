---
title: How to install Stacks CLI
---

The Stacks CLI enables interactions with the Stacks 2.0 blockchain through a set of commands.

## Installation

First, ensure you have `npm` installed. Next, run the following command in your terminal:

`npm install -g @stacks/cli`

:::tip

The `-g` flag makes the CLI commands available globally

:::

## Network selection

By default, the CLI will attempt to interact with the mainnet of the Stacks 2.0 blockchain. However, it is possible to override the network and set it to the testnet:

```sh
stx <command> -t
```

:::info

For account usage, that means addresses generated will _only_ be available for the specific network. An account generated for the testnet cannot be used on the mainnet.

:::

Using the `-t` flag causes the CLI to connect to the testnet node at `http://stacks-node-api.blockstack.org:20443`. To specify a node to connect to, add the `-I` flag followed by the URL of the node:

```sh
stx <command> -I "http://localhost:20443"
```

## Account

This section describes how to use the CLI to manage an account.

:::caution

It is not recommended to use the CLI to handle accounts with real STX tokens on the mainnet. Using an appropriate wallet build to support secure token holding is recommended.

:::

### Creating an account

You can generate a new account for testnet by using the `make_keychain` command with the `-t` option:

```bash
stx make_keychain -t
```

Your response should look like this:

```json
{
  "mnemonic": "private unhappy random runway boil scissors remove harvest fatigue inherit inquiry still before mountain pet tail mad accuse second milk client rebuild salt chase",
  "keyInfo": {
    "privateKey": "381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301",
    "address": "ST1BG7MHW2R524WMF7X8PGG3V45ZN040EB9EW0GQJ",
    "btcAddress": "n4X37UmRZYk9HawtS1w4xRtqJWhByxiz3c",
    "index": 0
  }
}
```

The mnemonic is your 24 word seed phrase which you should back up securely if you want access to this account again in the future. Once lost, it cannot be recovered.

The Stacks address associated with the newly generated account is:
`ST1BG7MHW2R524WMF7X8PGG3V45ZN040EB9EW0GQJ`

:::note

The preceding address is a testnet address that can only be used on the testnet.

:::

It is best to store the response of the CLI somewhere. You will need the private key, for instance, to send tokens to others.

### Checking balance

You can check the balance of your account using the following command:

```bash
stx balance ST1BG7MHW2R524WMF7X8PGG3V45ZN040EB9EW0GQJ -t
```

The response should look like this:

```json
{
  "balance": "10000",
  "nonce": 0
}
```

:::tip

To receive testnet STX tokens, use the [faucet](https://explorer.hiro.so/sandbox/faucet?chain=testnet).

:::

Take note that the nonce for the account is `0`. Account nonce is important for transaction broadcasting.

## Transactions

This section describes how to use the CLI to generate and broadcast transactions.

### Sending tokens

In order to send tokens, the CLI command requires 5 parameters:

- **Recipient Address**: The Stacks address of the recipient
- **Amount**: The number of Stacks to send denoted in microstacks (1 STX = 1000000 microstacks)
- **Fee Rate**: The transaction fee rate for this transaction. You can safely set a fee rate of 200 for Testnet
- **Nonce**: The nonce is a number that needs to be incremented monotonically for each transaction from the account. This ensures transactions are not duplicated
- **Private Key**: This is the private key corresponding to your account that was generated when

The CLI command to use with these parameters is `send_tokens`:

```bash
stx send_tokens ST2KMMVJAB00W5Z6XWTFPH6B13JE9RJ2DCSHYX0S7 1000 200 0 381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301 -t
```

```json
{
  "txid": "0xd32de0d66b4a07e0d7eeca320c37a10111c8c703315e79e17df76de6950c622c",
  "transaction": "https://explorer.hiro.so/txid/0xd32de0d66b4a07e0d7eeca320c37a10111c8c703315e79e17df76de6950c622c"
}
```

With this command we’re sending 1000 microstacks to the Stacks address `ST2KMMVJAB00W5Z6XWTFPH6B13JE9RJ2DCSHYX0S7`.

We set the fee rate to `200` microstacks. If you're not sure how much your transaction will cost.

:::tip

You can add the `-e` flag to estimate the transaction fee needed to get processed by the network, without broadcasting your transaction.

:::

The nonce is set to `0` for this transaction, since it will be the first transaction we send from this account. For subsequent transactions, you will need to increment this number by `1` each time. You can check the current nonce for the account using the `balance` command.

Finally, the last parameter is the private key for the account. `381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301`

Once again, we’re using the `-t` option to indicate that this is a Testnet transaction, so it should be broadcasted to Testnet.

If valid, the transaction will be broadcasted to the network and the command will respond with a transaction ID.

:::tip

To obtain the raw, serialized transaction payload without broadcasting it, you can add the `-x` flag

:::
