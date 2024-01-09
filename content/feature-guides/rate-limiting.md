---
Title: Rate Limiting
---

# Rate Limiting

Rate limiting will be applied to all API endpoints and [faucet requests](https://docs.hiro.so/api#tag/Faucets), based on the requested token addresses.

You can refer to the rate limit for each endpoint in the table below:

| **Endpoint**                                                                                | **Rate Per Minute(RPM) limit** |
| ------------------------------------------------------------------------------------------- |-----------------------|
| api.mainnet.hiro.so/extended/ <br/> api.hiro.so/extended/ <br/> | <br/> 500 <br/> <br/> |
| api.mainnet.hiro.so/rosetta/ <br/> api.hiro.so/rosetta/<br/>    | <br/> 200 <br/> <br/> |
| api.mainnet.hiro.so/v2/ <br/> api.hiro.so/v2/ <br/>             | <br/> 100 <br/> <br/> |
| api.testnet.hiro.so/extended/ <br/>                                           | 300 <br/>             |
| api.testnet.hiro.so/v2/ <br/>                                                 | 100 <br/>             |
| api.testnet.hiro.so/extended/v1/faucets/ <br/>                                | 1 <br/>               |

## STX faucet

The Stacks faucet rate limits depend on the type of request. For stacking requests, there is a limit of **1 request per 2 days**. In case of regular Stacks faucet requests, the limits are set to **1 request per minute**.
