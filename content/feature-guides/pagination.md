---
Title: Pagination
---

# Pagination

To make API responses more compact, lists returned by the API are paginated. For lists, the response body includes:

- `limit`: the number of list items return per response
- `offset`: the number of elements to skip (starting from 0)
- `total`: the number of all available list items
- `results`: the array of list items (length of array equals the set limit)

Here is a sample response:

```json
{
  "limit": 10,
  "offset": 0,
  "total": 101922,
  "results": [{
    "tx_id": "0x924e0a688664851f5f96b437fabaec19b7542cfcaaf92a97eae43384cacd83d0",
    "nonce": 308,
    "fee_rate": "0",
    "sender_address": "ST39F7SA0AKH7RB363W3NE2DTHD3P32ZHNX2KE7J9",
    "sponsored": false,
    "post_condition_mode": "deny",
    "post_conditions": [],
    "anchor_mode": "on_chain_only",
    "block_hash": "0x17ceb3da5f36aab351d6b14f5aa77f85bb6b800b954b2f24c564579f80116d99",
    "parent_block_hash": "0xe0d1e8d216a77526ae2ce40294fc77038798a179a6532bb8980d3c2183f58de6",
    "block_height": 14461,
    "burn_block_time": 1622875042,
    "burn_block_time_iso": "2021-06-05T06:37:22.000Z",
    "canonical": true,
    "tx_index": 0,
    "tx_status": "success",
    "tx_result": {},
    "microblock_hash": "",
    "microblock_sequence": 2147483647,
    "microblock_canonical": true,
    "event_count": 0,
    "events": [],
    "tx_type": "coinbase",
    "coinbase_payload": {}
    },
    {}
  ]
}
```

Using the `limit` and `offset` properties, you can paginate through the entire list by increasing the offset by the limit until you reach the total.
