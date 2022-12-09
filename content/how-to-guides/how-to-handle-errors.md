---
Title: Error Handling
---

#  Error Handling

The API can respond with two different error types:

- For URLs that do not match any defined endpoint, an HTTP 404 response is returned. The body of the response lists the URL in reference (as a string)
- For invalid input values (URL/body parameters), an HTTP 400 response is returned. The body of the response is a JSON object with an `error` property. The object also includes stack trace (`stack`) and an error UUID (`errorTag`)

## Proxied Stacks Node RPC API endpoints

The Stacks 2.0 Blockchain API is centrally hosted. However, every running Stacks node exposes an RPC API, which allows you to interact with the underlying blockchain. Instead of using a centrally hosted API, you may directly access the RPC API of a locally hosted node.

**Note:** The Stacks Blockchain API proxies to Node RPC endpoints.

While the Node RPC API doe not provide the same functionality as the hosted Stacks 2.0 Blockchain API, you will have similar functionality in a way that is scoped to that specific node. The RPC API includes the following endpoints:

- [POST /v2/transactions](https://docs.hiro.so/api#operation/post_core_node_transactions)
- [GET /v2/contracts/interface/{contract_address}/{contract_name}](https://docs.hiro.so/api#operation/get_contract_interface)
- [POST /v2/map_entry/{contract_address}/{contract_name}/{map_name}](https://docs.hiro.so/api#operation/get_contract_data_map_entry)
- [GET /v2/contracts/source/{contract_address}/{contract_name}](https://docs.hiro.so/api#operation/get_contract_source)
- [GET /v2/accounts/{principal}](https://docs.hiro.so/api#operation/get_account_info)
- [POST /v2/contracts/call-read/{contract_address}/{contract_name}/{function_name}](https://docs.hiro.so/api#operation/call_read_only_function)
- [GET /v2/fees/transfer](https://docs.hiro.so/api#operation/get_fee_transfer)
- [GET /v2/info](https://docs.hiro.so/api#operation/get_core_api_info)

If you run a local node, the node exposes an HTTP server on port `20443`. The info endpoint would be `localhost:20443/v2/info`.
