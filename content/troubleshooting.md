---
Title: Troubleshooting
---

# Troubleshooting

## I need help retrieving the requested information from an API endpoint.

As a first step, examine the HTTP response codes returned by the API call. The following are the classification groups:

- HTTP 2xx - Typically expected behavior ie; the API is responding as expected. Consider caching all or part of the response to reduce retrieval times in the future.
- HTTP 3xx - Redirecting; In this case, the client should be programmed to retry the call with the redirected URL or terminate the execution.
- HTTP 4xx - Client errors; This usually signifies a malformed request (for example - attempting to access a resource that has access restrictions or does not exist)
- HTTP 5xx - Server error; These typically signal an issue with the backend infrastructure.

In all cases, ensure that you log any erroneous debugging responses. Your application may be attempting to utilize deprecated endpoints, which can lead to the failure of the request. You must update these operations to use a different endpoint as soon as possible. To stay updated with deprecation events, subscribe to the [developer newsletter](https://www.hiro.so/updates).

Additionally, [Discord](https://discord.gg/pPwMzMx9k8) and [StackOverflow](https://stackoverflow.com/questions/tagged/stacks-blockchain+or+clarity-lang) are great resources for sharing knowledge and getting your questions addressed through the community.

## I'm hitting rate limits with API Calls

Hiro's Public Stacks API calls [are rate-limited](https://docs.hiro.so/stacks-blockchain-api/feature-guides/rate-limiting) to ensure high availability of the API and prevent abuse by a single or specific group of clients.

While increasing limits may only be feasible to be fair to some users, clients can employ various techniques to adapt to the rate limit. One example is using an [exponential back-off strategy](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry), which repeatedly retries the operation when hitting a rate limit. However, the time between each retry increases exponentially so that over a more extended period, the rate of requests adapts to the rate limit.

Caching API responses can also be handy, as not all information is updated frequently and can be stored locally to reduce API traffic. Depending on the use case, there may be multiple options to achieve this. For example, a client-side cache can be created/refreshed based on a combination of the following:

- Weight - Retain an item longer the more frequently it is accessed.
- Time - Let the cached item expire after a specific time interval - call the API the next time this item is required.
- On-Chain Events - If your application tracks on-chain events, some additional ways to build the cache would be based on block height, successful execution of a function/contract, etc.

Finally, more mature development projects can consider [running their own instances of the API](https://docs.hiro.so/get-started/running-api-node).
