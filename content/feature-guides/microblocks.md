---
Title: Microblocks 
---

# Microblocks

> **_NOTE:_**
> Please review the Microblocks API documentation carefully to ensure you are up-to-date on the latest implementation details for microblocks.

The Stacks Blockchain API enables you to query the most recently streamed microblocks when you run the following command:

```bash
# for mainnet, remove `.testnet`
curl 'https://stacks-node-api-microblocks.testnet.stacks.co/extended/v1/microblock'
```

```json
{
  "limit": 20,
  "offset": 0,
  "total": 8766,
  "results": [
    {
      "canonical": true,
      "microblock_canonical": true,
      "microblock_hash": "0xe6897aab881208185e3fb6ba58d9d9e35c43c68f13fbb892b20cebd39ac69567",
      "microblock_sequence": 0,
      "microblock_parent_hash": "0xe0d1e8d216a77526ae2ce40294fc77038798a179a6532bb8980d3c2183f58de6",
      "parent_index_block_hash": "0x178cd9a37bf38f6b85d9f18e65588e60782753b1463ae080fb9865938b0898ea",
      "block_height": 14461,
      "parent_block_height": 14460,
      "parent_block_hash": "0xe0d1e8d216a77526ae2ce40294fc77038798a179a6532bb8980d3c2183f58de6",
      "block_hash": "0x17ceb3da5f36aab351d6b14f5aa77f85bb6b800b954b2f24c564579f80116d99",
      "txs": ["0x0622e096dec7e2f6e8f7d95f732e04d238b7381aea8d0aecffae026c53e73e05"]
    }
  ]
}
```
