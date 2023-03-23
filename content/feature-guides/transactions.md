---
title: Transactions
---

# Transactions

Transactions are the fundamental unit of execution in the Stacks blockchain. Each transaction is originated from a [Stacks 2.0 account](https://docs.stacks.co/understand-stacks/accounts), and is retained in the Stacks blockchain history. This guide helps you understand Stacks 2.0 transactions.

## Lifecycle

Transactions go through phases before being finally confirmed, and available for all, on the Stacks 2.0 network.

- **Generate**: Transactions are assembled according to the encoding specification.
- **Validate and sign**: Transactions are validated to confirm they are well-formed. Required signatures are filled in.
- **Broadcast**: Transactions are sent to a node.
- **Register**: A miner receives transactions, verifies, and adds them to the ["mempool"](https://academy.binance.com/en/glossary/mempool), a holding area for all the pending transactions.
- **Process**: Miners review the mempool and select transactions for the next block to be mined. Depending on the transaction type, different actions can happen during this step. For example, post-conditions could be verified for a token transfer, smart-contract defined tokens could be minted, or an attempt to call an existing smart contract method could be made.
- **Confirm**: Miners successfully mine blocks with a set of transactions. The transactions inside are successfully propagated to the network.

:::info

A transaction can have one of three states once it is registered: `pending`, `success`, or `failed`.

:::

## Types

The Stacks 2.0 supports a set of different transaction types:

| **Type**          | **Value**           | **Description**                                                                                                                                                                                       |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coinbase          | `coinbase`          | The first transaction in a new block (an entity holding several transactions). Used to register for block rewards. These are not manually generated and broadcasted like other types of transactions. |
| Token transfer    | `token_transfer`    | Asset transfer from a sender to a recipient                                                                                                                                                           |
| Contract deploy   | `smart_contract`    | Contract instantiation                                                                                                                                                                                |
| Contract call     | `contract_call`     | Contract call for a public, non read-only function                                                                                                                                                    |
| Poison Microblock | `poison_microblock` | Punish leaders who intentionally equivocate about the microblocks they package                                                                                                                        |

A sample of each transaction type can be found in the [Stacks Blockchain API response definition for transactions](https://docs.hiro.so/api#operation/get_transaction_by_id).

~> Read-only contract call calls do **not** require transactions. Read more about it in the [network guide](https://docs.stacks.co/understand-stacks/network#read-only-function-calls).

## Anchor mode

Transactions can be mined either in an anchor block or in a [microblock](https://docs.stacks.co/understand-stacks/microblocks). If microblocks
are selected, the transaction can be confirmed with a lower latency than the anchor block time.

The anchor mode enum has three options:

- `OnChainOnly` The transaction MUST be included in an anchored block
- `OffChainOnly`: The transaction MUST be included in a microblock
- `Any`: The leader can choose where to include the transaction

Here is an example where the transaction must be included in a microblock:

```js
import { AnchorMode, makeSTXTokenTransfer } from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";

const BigNum = require("bn.js");

const txOptions = {
  recipient: "SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159",
  amount: new BigNum(12345),
  senderKey:
    "b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01",
  network: new StacksTestnet(), // for mainnet, use `StacksMainnet()`
  anchorMode: AnchorMode.OffChainOnly, // must be included in a microblock
};

const transaction = await makeSTXTokenTransfer(txOptions);
```

## Post-conditions

Transaction post-conditions are a feature meant to limit the damage malicious smart contract developers and smart contract bugs can do in terms of destroying a user's assets. Post-conditions are executed whenever a contract is instantiated or a public method of an existing contract is executed. Whenever a post-condition fails, a transaction will be forced to abort.

Post-conditions are meant to be added by the user (or by the user's wallet software) at the moment they sign a transaction. For example, a user may append a post-condition saying that upon successful execution, their account's Stacks (STX) balance should have decreased by no more than 1 STX. If this is not the case, then the transaction would abort and the account would only pay the transaction fee of processing it.

### Attributes

Each transaction includes a field that describes zero or more post-conditions that must all be true when the transaction finishes running. The post-condition describes only properties of the owner of the asset before the transaction happened. For a transfer transaction, the post-condition is about the sender, for a burn transaction, the post-condition is about the previous owner. A post-condition includes the following information:

| **Attribute**                                                        | **Sample**                                  | **Description**                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Principal](https://docs.stacks.co/write-smart-contracts/principals) | `SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE` | original owner of the asset, can be a Stacks address or a contract                               |
| Asset id                                                             | `STX`                                       | Asset to apply conditions to (could be Stacks, fungible, or non-fungible tokens)                 |
| Comparator                                                           | `>=`                                        | Compare operation to be applied (could define "how much" or "whether or not the asset is owned") |
| Literal                                                              | `1000000`                                   | Integer or boolean value used to compare instances of the asset against via the condition        |

### Evaluation modes

The Stacks blockchain supports an `allow` or `deny` mode for evaluating post-conditions:

- Allow: other asset transfers not covered by the post-conditions are permitted
- Deny: no other asset transfers are permitted besides those named in the post-conditions

## Authorization

Transactions can be authorized in two ways: _standard_ and _sponsored_. The authorization determines whether or not the originating account is also the paying account. In a transaction with a standard authorization, the origin and paying accounts are the same. In a transaction with a sponsored authorization, the origin and paying accounts are distinct, and both accounts must sign the transaction for it to be valid (first the origin, then the spender).

**Sponsored transactions** enable developers and/or infrastructure operators to pay for users to call into their smart contracts, even if users do not have the Stacks (STX) to do so.

The signing flow for sponsored transactions would be to have the user first sign the transaction with their origin account with the intent of it being sponsored (that is, the user must explicitly allow a sponsor to sign), and then have the sponsor sign with their paying account to pay for the user's transaction fee.

## Encoding

A transaction includes the following information. Multiple-byte fields are encoded as big-endian.

| **Type**        | **Description**                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version number  | Network version. `0x80` for testnet, `0x0` for mainnet                                                                                                                                                             |
| Chain ID        | Chain instance ID. `0x80000000` for testnet, `0x00000001` for mainnet                                                                                                                                              |
| Authorization   | Type of authorization (`0x04` for standard, `0x05` for sponsored) and [spending conditions](https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md#transaction-authorization) |
| Post-conditions | List of post-conditions, each including a [type ID and variable-length condition body](https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md#transaction-post-conditions-1)  |
| Payload         | Transaction type and variable-length [payload](https://github.com/stacksgov/sips/blob/main/sips/sip-005/sip-005-blocks-and-transactions.md#transaction-payloads-1)                                                 |

## Construction

The easiest way to construct well-formed transactions is by [using the Stacks Transactions JS library](https://github.com/blockstack/stacks.js/tree/master/packages/transactions#post-conditions). You can construct the following transaction types:

- Stacks token transfer
- Smart contract deploy
- Smart contract function call

When constructing transactions, it is required to set the network the transaction is intended for. This can be either mainnet or testnet. At the moment of this writing, the only available option is the [testnet network](https://docs.stacks.co/understand-stacks/testnet).

:::info

Transactions can be constructed and serialized offline. However, it is required to know the nonce and estimated fees ahead of time. Once internet access is available, the transaction can be broadcasted to the network. Keep in mind that the nonce and fee might change during offline activity, making the transaction invalid.

:::

### Stacks Token transfer

```js
import { makeSTXTokenTransfer } from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";

const BigNum = require("bn.js");

const txOptions = {
  recipient: "SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159",
  amount: new BigNum(12345),
  senderKey:
    "b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01",
  network: new StacksTestnet(), // for mainnet, use `StacksMainnet()`
  memo: "test memo",
  nonce: new BigNum(0), // set a nonce manually if you don't want builder to fetch from a Stacks node
  fee: new BigNum(200), // set a tx fee if you don't want the builder to estimate
};

const transaction = await makeSTXTokenTransfer(txOptions);
```

:::info

Read more about [nonces](http://docs.stacks.co/understand-stacks/network#nonces) in the network guide

:::

### Smart contract deployment

```js
import { makeContractDeploy } from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";
const BigNum = require("bn.js");

const txOptions = {
  contractName: "contract_name",
  codeBody: fs.readFileSync("/path/to/contract.clar").toString(),
  senderKey:
    "b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01",
  network: new StacksTestnet(), // for mainnet, use `StacksMainnet()`
};

const transaction = await makeContractDeploy(txOptions);
```

### Smart contract function call

```js
import { makeContractCall, BufferCV } from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";

const BigNum = require("bn.js");

const txOptions = {
  contractAddress: "SPBMRFRPPGCDE3F384WCJPK8PQJGZ8K9QKK7F59X",
  contractName: "contract_name",
  functionName: "contract_function",
  functionArgs: [bufferCVFromString("foo")],
  senderKey:
    "b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01",
  // attempt to fetch this contracts interface and validate the provided functionArgs
  validateWithAbi: true,
  network: new StacksTestnet(), // for mainnet, use `StacksMainnet()`
};

const transaction = await makeContractCall(txOptions);
```

### Clarity value types

Building transactions that call functions in deployed clarity contracts requires you to construct valid Clarity Values to pass to the function as arguments. The [Clarity type system](https://github.com/stacksgov/sips/blob/main/sips/sip-002/sip-002-smart-contract-language.md#clarity-type-system) contains the following types:

| Type             | Declaration                                                  | Description                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tuple            | `(tuple (key-name-0 key-type-0) ...)`                        | Typed tuple with named fields                                                                                                                                                       |
| List             | `(list max-len entry-type)`                                  | List of maximum length max-len, with entries of type entry-type                                                                                                                     |
| Response         | `(response ok-type err-type)`                                | Object used by public functions to commit their changes or abort. May be returned or used by other functions as well, however, only public functions have the commit/abort behavior |
| Optional         | `(optional some-type)`                                       | Option type for objects that can either be (some value) or none                                                                                                                     |
| Buffer           | `(buff max-len)`                                             | Byte buffer with maximum length `max-len`                                                                                                                                           |
| Principal        | `principal`                                                  | Object representing a principal (whether a contract principal or standard principal)                                                                                                |
| Boolean          | `bool`                                                       | Boolean value ('true or 'false)                                                                                                                                                     |
| Signed Integer   | `int`                                                        | Signed 128-bit integer                                                                                                                                                              |
| Unsigned Integer | `uint`                                                       | Unsigned 128-bit integer                                                                                                                                                            |
| ASCII String     | `(define-data-var my-str (string-ascii 11) "hello world")`   | String value encoded in ASCII                                                                                                                                                       |
| UTF-8 String     | `(define-data-var my-str (string-utf8 7) u"hello \u{1234}")` | String value encoded in UTF-8                                                                                                                                                       |

The Stacks Transactions JS library contains TypeScript types and classes that map to the Clarity types, in order to make it easy to construct well-typed Clarity values in JavaScript. These types all extend the abstract class `ClarityValue`.

Here are samples for Clarity value constructions using this library:

```js
// construct boolean clarity values
const t = trueCV();
const f = falseCV();

// construct optional clarity values
const nothing = noneCV();
const something = someCV(t);

// construct a buffer clarity value from an existing Buffer
const buffer = Buffer.from("foo");
const bufCV = bufferCV(buffer);

// construct signed and unsigned integer clarity values
const i = intCV(-10);
const u = uintCV(10);

// construct principal clarity values
const address = "SP2JXKMSH007NPYAQHKJPQMAQYAD90NQGTVJVQ02B";
const contractName = "contract-name";
const spCV = standardPrincipalCV(address);
const cpCV = contractPrincipalCV(address, contractName);

// construct response clarity values
const errCV = responseErrorCV(trueCV());
const okCV = responseOkCV(falseCV());

// construct tuple clarity values
const tupCV = tupleCV({
  a: intCV(1),
  b: trueCV(),
  c: falseCV(),
});

// construct list clarity values
const l = listCV([trueCV(), falseCV()]);
```

If you develop in Typescript, the type checker can help prevent you from creating wrongly typed Clarity values. For example, the following code won't compile since in Clarity lists are homogeneous, meaning they can only contain values of a single type. It is important to include the type variable `BooleanCV` in this example, otherwise the typescript type checker won't know which type the list is of and won't enforce homogeneity.

```js
const l = listCV < BooleanCV > [trueCV(), intCV(1)];
```

### Setting post-conditions

The Stacks Transactions JS library supports the construction of post conditions.

Here is an example of a post condition that ensures the account's balance will only decrease by no more than 1 STX:

```js
const account = 'SP2ZD731ANQZT6J4K3F5N8A40ZXWXC1XFXHVVQFKE';
const comparator = FungibleConditionCode.GreaterEqual;
// assuming the Stacks (STX) balance before the transaction is 12346
const amount = new BigNum(12345);

const standardSTXPostCondition = makeStandardSTXPostCondition(
  account,
  comparator,
  amount
);

const txOptions = {
  ..., // other transaction options
  postConditions: [standardSTXPostCondition]
}

const transaction = await makeContractCall(txOptions);
```

## Serialization

A well-formed transaction construct is encoded in [Recursive Length Prefix ("RLP")](https://eth.wiki/en/fundamentals/rlp). RLP encoding results in a variable-sized byte array.

In order to broadcast transactions to and between nodes on the network, RLP data is represented in hexadecimal string (also called the **raw format**).

To support an API-friendly and human-readable representation, the [Stacks Blockchain API](/get-started/stacks-blockchain-api) converts transactions into a JSON format.

=> [The Stacks Transactions JS library](https://github.com/blockstack/stacks.js) supports serialization of transactions.

### Raw format

Broadcasting transactions directly to the Stacks Blockchain API or Node RPC API requires the transaction to be serialized and in hexadecimal representation.

```js
// to see the raw serialized tx
const serializedTx = transaction.serialize().toString("hex");

console.log(serializedTx);
```

The preceding method returns the following string:

```bash
8080000000040015c31b8c1c11c515e244b75806bac48d1399c77500000000000000000000000000000000000127e88a68dce8689fc94ff4c186bf8966f8d544c5129ff84d95a2459b5e8e7c39430388f6c8f85cce8c9ce5e6ec1e157116ca4a67d65ab53768b25d5fb5831939030200000000000516df0ba3e79792be7be5e50a370289accfc8c9e03200000000000f424068656c6c6f20776f726c640000000000000000000000000000000000000000000000
```

-> Transaction IDs are generated by hashing the raw transaction with [sha512/256](https://eprint.iacr.org/2010/548.pdf)

### JSON format

When called the Stacks Blockchain API or Node RPC API, transactions returned will be serialized in a JSON format. Here is a token transfer transaction:

```js
{
  "tx_id": "0x77cb1bf0804f09ad24b4c494a6c00d5b10bb0afbb94a0d646fa9640eff338e37",
  "nonce": 5893,
  "fee_rate": "180",
  "sender_address": "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6",
  "sponsored": false,
  "post_condition_mode": "deny",
  "post_conditions": [],
  "anchor_mode": "any",
  "block_hash": "0xf1e54a3acd04232f1362c09d5096b095363158348303396ea5fc5092e1d8788f",
  "parent_block_hash": "0x3de356eb5afa5d7b781f6a925d31d69d218b772ec995930b4e15d92bd15443f9",
  "block_height": 13984,
  "burn_block_time": 1622678407,
  "burn_block_time_iso": "2021-06-03T00:00:07.000Z",
  "canonical": true,
  "tx_index": 2,
  "tx_status": "success",
  "tx_result": {
    "hex": "0x0703",
    "repr": "(ok true)"
  },
  "microblock_hash": "",
  "microblock_sequence": 2147483647,
  "microblock_canonical": true,
  "event_count": 1,
  "events": [],
  "tx_type": "token_transfer",
  "token_transfer": {
    "recipient_address": "STZ4C5RT4WH4JGRQA5E0ZF5PPSQCVY1WRB6E2CGW",
    "amount": "500000000",
    "memo": "0x46617563657400000000000000000000000000000000000000000000000000000000"
  }
}
```

### Deserializing

Serialized, raw transactions can be deserialized without access to the internet using [the Stacks Transactions JS library](https://github.com/blockstack/stacks.js/tree/master/packages/transactions):

```js
import { BufferReader, deserializeTransaction } from "@stacks/transactions";

// receive raw transaction
const serializedTx = "808000000...";

const bufferReader = new BufferReader(Buffer.from(serializedTx));
const deserializedTx = deserializeTransaction(bufferReader);

// print memo
console.log(deserializedTx.payload.memo.content);
```

## Signature and Verification

Every transaction contains verifiable signatures that certify its authenticity. These signatures are generated by signing the transaction hash with the origin's private key. The Elliptic Curve Digital Signature Algorithm (ECDSA) is used for signing, with the curve set to secp256k1. The internal structure that encapsulates the signature is the spending condition. Spending conditions include several parameters including the public key hash, nonce, fee rate and the recoverable ECDSA signature.

When constructing a transaction using the JS library, you can supply the private key and signing will be completed automatically. If you would like to sign the transaction manually, use the `TransactionSigner` class.

Below are the steps taken to generate the signature internal to the transaction library.

### Signing steps

Step 1: Generate a transaction hash for signing. This is the SHA512/256 digest of the serialized transaction before a signature is added.

Step 2: Append the authorization type, fee amount and nonce to the transaction hash to create the signature hash.

Step 3: Generate the SHA512/256 hash of the resulting string from the previous step.

Step 4: Sign the hash using ECDSA and the origin private key.

Step 5: Add the resulting recoverable ECDSA signature to the transaction spending condition.

### Single signature transaction

As the name implies a single signature transaction contains 1 signature from the origin account that authorizes a token spend or smart contract deploy/execution.

### Multi-signature transaction

For multi-sig accounts, multiple keys must sign the transaction for it to be valid.

### Sponsored transaction

A sponsored transaction is one where a second signer sets and pays the transaction fees. The origin must sign the transaction first before the sponsor signs.

## Broadcast

With a serialized transaction in the [raw format](#raw-format), it can be broadcast to the network using the [`POST /v2/transactions`](https://docs.hiro.so/api#operation/post_core_node_transactions) endpoint:

```bash
# for mainnet, replace `testnet` with `mainnet`
curl --location --request POST 'https://api.testnet.hiro.so/v2/transactions' \
--header 'Content-Type: application/octet-stream' \
--data-raw '<tx_raw_format>'
```

The API will respond with a `HTTP 200 - OK` if the transaction was successfully added to the mempool.

There is no explicit time constraint between the construction of a valid signed transaction and when it can be broadcast. There are, however, some constraints to be aware of. The following reasons can deem a transaction invalid after some period:

- Token transfer: Nonce changed in-between construction and broadcast
- Contract call or deploy: Block height is evaluated (with [`at-block`](https://docs.stacks.co/references/language-functions#at-block)) and changed in-between construction and broadcast

## Mempool

Once a transaction has been successfully broadcast to the network, the transaction is added to the mempool of the node
that received the broadcast. From the [Bitcoin wiki][]: "a node's memory pool contains all 0-confirmation transactions
across the entire network that that particular node knows about." So, the set of transactions in the mempool might be
different for each node in the network. For example, when you query the mempool endpoints on
`api.mainnet.hiro.so`, the response reflects the set of unconfirmed transactions known to the nodes that
service that API.

Miners can employ different heuristics and strategies for deciding which transactions to admit into the mempool and
which transactions to include from the mempool when mining a block. Some transactions may be rejected outright (for
example, if there are insufficient funds at an address) while others might be accepted into the mempool, but not mined
into a block indefinitely (for example if fees are too low). Transactions that are admitted in the mempool but not yet
mined are said to be "pending." The current implementation of [stacks-blockchain][] discards pending mempool
transactions after [256 blocks][].

### Best practices

- **Nonce:** it's crucial that transactions use the correct nonce. Using an incorrect nonce makes it less likely that
  the transaction is mined in a timely manner. To determine the correct nonce, query the [`accounts`][] endpoint of
  the node you intend to broadcast your transaction to. The value of the `nonce` field of the response is the next nonce
  that the node expects to consume for that account. Nonce starts at `0`, so the first transaction from an account should
  be set to `nonce=0`.
- **Transaction chaining:** even when using the correct nonce, transactions might arrive at a node out-of-order. For
  instance, a transaction with `nonce=1` may arrive in the mempool before the `nonce=0` transaction. Stacks nodes admit
  such out-of-order transactions in the mempool, but only up to a limit ([25 in the current implementation][]). So, you
  should limit any chain of unconfirmed transactions from a single account to less than 25. Making this limit higher has
  downsides, discussed in [this issue](https://github.com/blockstack/stacks-blockchain/issues/2384). If you need to send
  more than 25 transactions per block, consider using multiple accounts or a smart-contract based approach. See
  [this tool](https://www.npmjs.com/package/@stacks/send-many-stx-cli), for example, that allows up to 200 token
  transfers in a single transaction.

## Querying

Transactions on the Stacks 2.0 network can be queried using the [Stacks Blockchain API](/get-started/stacks-blockchain-api). The API exposes two interfaces, a RESTful JSON API and a WebSockets API.

For convenience, a Postman Collection was created and published: [![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/614feab5c108d292bffa)

-> Note: The API can be easily consumed using a generated [JS client library](https://hirosystems.github.io/stacks-blockchain-api/client/index.html). The generator uses an OpenAPI specification and supports other languages and frameworks.

@include "stacks-api-pagination.md"

### Get recent transactions

Recent transactions can be obtained through the [`GET /extended/v1/tx`](https://docs.hiro.so/api#operation/get_transaction_list) endpoint:

```bash
# for mainnet, replace `testnet` with `mainnet`
curl 'https://api.testnet.hiro.so/extended/v1/tx'
```

Sample response:

```js
{
  "limit": 10,
  "offset": 0,
  "total": 101922,
  "results": [
    {
      "tx_id": "0x5e9f3933e358df6a73fec0d47ce3e1062c20812c129f5294e6f37a8d27c051d9",
      "tx_status": "success",
      "tx_type": "coinbase",
      "fee_rate": "0",
      "sender_address": "ST3WCQ6S0DFT7YHF53M8JPKGDS1N1GSSR91677XF1",
      "sponsored": false,
      "post_condition_mode": "deny",
      "block_hash": "0x58412b50266debd0c35b1a20348ad9c0f17e5525fb155a97033256c83c9e2491",
      "block_height": 3231,
      "burn_block_time": 1594230455,
      "canonical": true,
      "tx_index": 0,
      "coinbase_payload": {
        "data": "0x0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  ]
}
```

### Get mempool transactions

Mempool (registered, but not processed) transactions can be obtained using the [`GET /extended/v1/tx/mempool`](https://docs.hiro.so/api#operation/get_mempool_transaction_list) endpoint:

```bash
# for mainnet, replace `testnet` with `mainnet`
curl 'https://api.testnet.hiro.so/extended/v1/tx/mempool'
```

Sample response:

```js
{
  "limit": 96,
  "offset": 0,
  "total": 5,
  "results": [
    {
      "tx_id": "0xb31df5a363dad31723324cb5e0eefa04d491519fd30827a521cbc830114aa50c",
      "tx_status": "pending",
      "tx_type": "token_transfer",
      "receipt_time": 1598288370,
      "receipt_time_iso": "2020-08-24T16:59:30.000Z",
      "fee_rate": "180",
      "sender_address": "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6",
      "sponsored": false,
      "post_condition_mode": "deny",
      "token_transfer": {
        "recipient_address": "ST1GY25DM8RZV4X15X07THRZ2C5NMWPGQWKFGV87F",
        "amount": "500000",
        "memo": "0x46617563657400000000000000000000000000000000000000000000000000000000"
      }
    }
  ]
}
```

-> The `memo` field is represented as a hexadecimal string of a byte buffer

#### Filter by type

Recent transactions can be filtered by [transaction type](#types) using the `type` query parameter:

```bash
# for mainnet, replace `testnet` with `mainnet`
curl 'https://api.testnet.hiro.so/extended/v1/tx/?type=contract_call'
```

### Get transaction by ID

A specific transaction can be obtained using the [`GET /extended/v1/tx/<tx_id>`](https://docs.hiro.so/api#operation/get_transaction_by_id) endpoint:

```bash
# for mainnet, replace `testnet` with `mainnet`
curl 'https://api.testnet.hiro.so/extended/v1/tx/<tx_id>'
```

Sample response:

```js
{
  "limit": 96,
  "offset": 0,
  "total": 5,
  "results": [
    {
      "tx_id": "0xb31df5a363dad31723324cb5e0eefa04d491519fd30827a521cbc830114aa50c",
      "tx_status": "pending",
      "tx_type": "token_transfer",
      "receipt_time": 1598288370,
      "receipt_time_iso": "2020-08-24T16:59:30.000Z",
      "fee_rate": "180",
      "sender_address": "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6",
      "sponsored": false,
      "post_condition_mode": "deny",
      "token_transfer": {
        "recipient_address": "ST1GY25DM8RZV4X15X07THRZ2C5NMWPGQWKFGV87F",
        "amount": "500000",
        "memo": "0x46617563657400000000000000000000000000000000000000000000000000000000"
      }
    }
  ]
}
```

## Garbage Collection

Broadcast transactions stay in the mempool for 256 blocks (~42 hours). If a transaction is not confirmed within that time, it is removed from the mempool.

!> Most transactions stay in the mempool due to nonce issues. If you see a transaction pending for an unusual time, review the nonce of the account and the transaction.

If a transaction is removed from the mempool, the transaction was not processed and no changes were made to the blockchain state.

[bitcoin wiki]: https://en.bitcoin.it/wiki/Vocabulary#Memory_pool
[256 blocks]: https://github.com/blockstack/stacks-blockchain/blob/master/src/core/mempool.rs#L59
[stacks-blockchain]: https://github.com/blockstack/stacks-blockchain
[`accounts`]: https://docs.stacks.co/understand-stacks/accounts#get-stacks-stx-balance-and-nonce
[25 in the current implementation]: https://github.com/blockstack/stacks-blockchain/blob/08c4b9d61b48b99475c0197e7e7fea50c7fb0e29/src/core/mempool.rs#L66
