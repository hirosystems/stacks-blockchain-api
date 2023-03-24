---
Title: Nonce Handling
---

# Nonce handling

In order to prevent "stuck" transactions, you must track the next available nonce for principals issuing transactions. The
Stacks Blockchain API provides an endpoint to make nonce handling simpler when using the following command:

```bash
# for mainnet, remove `.testnet`
# replace <principal> with your STX address
curl 'https://api.testnet.hiro.so/extended/v1/address/<principal>/nonces'
```

```json
{
  "last_executed_tx_nonce": 5893,
  "last_mempool_tx_nonce": null,
  "possible_next_nonce": 5894,
  "detected_missing_nonces": []
}
```

The `possible_next_nonce` property is the predicted nonce required for subsequent transactions, which is derived from inspecting the latest transaction nonces from both anchor blocks, microblocks, and mempool.

The `detected_missing_nonces` property finds any non-contiguous nonces after inspecting transactions from anchor blocks, microblocks, and the mempool. For example, if the latest anchor/microblock transaction nonce for an account is 5, but the next nonce in the mempool is 7, then it indicates that something likely went wrong with transaction with nonce 6 (either it was not created or broadcasted correctly by a client, or it was dropped for whatever reason). This is a strong indication that the mempool transaction with nonce 7 will never be mined since the previous nonce is missing.

Clients that continue to broadcast transactions with the `possible_next_nonce` property of 8, then 9, then 10, will likely result in all of their pending/mempool transactions never going through.
