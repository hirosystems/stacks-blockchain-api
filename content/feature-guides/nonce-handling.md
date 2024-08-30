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

The `possible_next_nonce` property is the nonce suggested for a given principal's next transaction. It is derived as the next integer to the largest nonce found in blocks and mempool. It does not take into account missing nonces.

The `detected_missing_nonces` property finds any non-contiguous nonces after inspecting transactions from blocks and the mempool. For example, for a given principal, if the latest transaction included in a block has a nonce of 5, and the's only one transaction in the mempool with nonce 7, then it indicates that something likely went wrong with transaction with nonce 6 (either it was not created or broadcasted correctly by a client, or it was dropped for whatever reason). This is a strong indication that the mempool transaction with nonce 7 will never be mined since the previous nonce is missing.

Clients that continue to broadcast transactions with the `possible_next_nonce` property of 8, then 9, then 10, will likely result in all of their pending/mempool transactions never going through. For all transactions go through, clients should first use any missing nonces before using the suggested `possible_next_nonce`.
