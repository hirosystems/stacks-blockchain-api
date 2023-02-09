---
Title: Search Endpoint
---

# Search Endpoint

The Stacks Blockchain API provides a search endpoint ([`/extended/v1/search/{id}`](https://docs.hiro.so/api#operation/search_by_id)) that takes an identifier and responds with matching blocks, transactions, contracts, or accounts.

The search operation used by the endpoint (for example, `FROM txs WHERE tx_id = $1 LIMIT 1`) matches hashes **equal** to the provided identifier. Fuzzy search, incomplete identifiers, or wildcards will not return any matches.
