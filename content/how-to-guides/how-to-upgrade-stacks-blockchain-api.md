---
Title: Upgrade Stacks Blockchain API version
---

# Upgrade Stacks Blockchain API version

Over time, the Stacks Blockchain API may be updated to a newer version, providing you additonal features and benefits not available in previous versions. When a new API version is released, you may want to upgrade the Stacks Blockchain API version to this new, stable version.

The process to upgrade the API version is descibed below.

# Upgrading the API Version

>  **_NOTE:_**
>
> If you choose to upgrade the Stacks Blockchain API to a new major version (for example, 3.0.0 to 4.0.0), then the Postgres database from the previous version will not be compatible and the upgrade process will fail to start.

When upgrading the API version, you must use Event Replay. Failure to do so will require wiping both the Stacks Blockchain chainstate data and the API Postgres database, and then re-syncing from scratch.

## Event Replay

The stacks-node is only able to emit events live as they happen. This poses a problem in the scenario where the stacks-blockchain-api needs to be upgraded and its database cannot be migrated to a new schema. One way to handle this upgrade is to wipe the stacks-blockchain-api's database and stacks-node working directory, and re-sync from scratch.

Alternatively, an event-replay feature is available where the API records the HTTP `POST` requests from the stacks-node event emitter, then streams these events back to itself. This essentially simulaties a wipe and full re-sync, although this is much faster.

The Event Replay feature can be used via program args. For example, if there are breaking changes in the API's SQL schema, such as adding a new column which requires events to be re-played, the steps described below can be run.

### Event Replay Instructions

#### V1 BNS Data

This process is optional, but recommended. If you want to retrieve the V1 BNS data, there will be a few extra steps you need to perform.

1. Download BNS data using the command below.

`curl -L https://storage.googleapis.com/blockstack-v1-migration-data/export-data.tar.gz -o /stacks-node/bns/export-data.tar.gz`

2. Extract the data by entering the command below.

`tar -xzvf ./bns/export-data.tar.gz -C /stacks-node/bns/`

3. Each file in `./bns` will have a corresponding sha256 value. To verify the sha256 sum value, run the following script:

```for file in `ls /stacks-node/bns/* | grep -v sha256 | grep -v .tar.gz`; do
    if [ $(sha256sum $file | awk {'print $1'}) == $(cat ${file}.sha256 ) ]; then
        echo "sha256 Matched $file"
    else
        echo "sha256 Mismatch $file"
    fi
done```

4. Set the data's location as the value of `BNS_IMPORT_DIR` in your `.env` file.

#### Export and Import

To export and/or import event data, follow the steps listed below.

1. Ensure the API process is not running. When stopping the API, let the process exit gracefully so that any in-progress SQL writes can finish.

2. Export event data to disk with the export-events command:

`node ./lib/index.js export-events --file /tmp/stacks-node-events.tsv`

3. Update the API version to the new stacks-blockchain-api version.

4. Perform the event playback using the `import-events` command.

**WARNING**: This action will drop all tables from the configured Postgres database, including any tables not automatically added by the API.

`node ./lib/index.js import-events --file /tmp/stacks-node-events.tsv --wipe-db --force`

This command has two modes of operation, specified by the `--mode` option:

- **archival (default)**: The process will import and ingest all blockchain events that have happened since the first block.
- **pruned**: The import process will ignore some prunable events (mempool, microblocks) until the import block height has reached `chain tip - 256` blocks. This saves a considerable amount of time during import, but sacrifices some historical data. You can use this mode if you are mostly interested in running an API version that prioritizes real-time information.

Alternatively, instead of performing the `export-events` command in step 1, an environmental variable can be set which enables events to be streamed to a file as they are received, while the application is running normally. To enable this feature, set the `STACKS_EXPORT_EVENTS_FILE` environment variable to the file path where events should be appended. 

For example:

`STACKS_EXPORT_EVENTS_FILE=/tmp/stacks-node-events.tsv`
