---
Title: Rate Limiting
---

# Rate Limiting

Rate limiting will be applied to all API endpoints and [faucet requests](https://docs.hiro.so/api#tag/Faucets), based on the requested token addresses.

You can refer to the rate limit for each endpoint in the table below:

| **Endpoint**                                                                                | **Rate-Limit (RPM)**  |
| ------------------------------------------------------------------------------------------- |-----------------------|
| stacks-node-api.mainnet.stacks.co/extended/ <br/> stacks-node-api.stacks.co/extended/ <br/> | <br/> 500 <br/> <br/> |
| stacks-node-api.mainnet.stacks.co/rosetta/ <br/> stacks-node-api.stacks.co/rosetta/<br/>    | <br/> 200 <br/> <br/> |
| stacks-node-api.mainnet.stacks.co/v2/ <br/> stacks-node-api.stacks.co/v2/ <br/>             | <br/> 100 <br/> <br/> |
| stacks-node-api.testnet.stacks.co/extended/ <br/>                                           | 300 <br/>             |
| stacks-node-api.testnet.stacks.co/v2/ <br/>                                                 | 100 <br/>             |
| stacks-node-api.testnet.stacks.co/extended/v1/faucets/ <br/>                                | 1 <br/>               |

## STX faucet

The Stacks faucet rate limits depend on the type of request. For stacking requests, there is a limit of **1 request per 2 days**. In case of regular Stacks faucet requests, the limits are set to **1 request per minute**.
