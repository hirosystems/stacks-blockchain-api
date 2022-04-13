### Usage

Perform an event-replay import with a recent TSV (at least block height 52499).

Run API in readonly mode with profiling enabled:
```shell
npm run build
STACKS_PROFILER_PORT=9119 STACKS_BLOCKCHAIN_API_PORT=3998 STACKS_API_MODE=readonly STACKS_CHAIN_ID=0x80000000 NODE_ENV=production node lib/index.js
```

Run load test script inside this directory:
```shell
./load-test.sh ./sampled-requests.txt
```

The script reads from the list of GET http endpoints, sampled from real-world traffic. It initiates a "start CPU profiling" request to the API, then iterates through the sampled endpoints using curl, issuing requests as fast as the server can respond.

It also checks for non-200 responses and will exit with an error if found. This can be used for regression testing to ensure the sampled endpoints at least return a success code.

Once all requests have been issued, a "stop CPU profiling" request is sent. The profile result is saved to disk in this directory as a `*.cpuprofile` file. This can be opened in vscode to analyze.

