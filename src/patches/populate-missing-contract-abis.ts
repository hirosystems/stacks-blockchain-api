#!/usr/bin/env node

import { connectPostgres, PgSqlClient } from '@hirosystems/api-toolkit';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { getConnectionArgs, getConnectionConfig } from '../datastore/connection';
import { ClarityAbi } from '../event-stream/contract-abi';
import { loadDotEnv } from '../helpers';
import { logger } from '../logger';

async function main() {
  // 1) Environment + DB Setup
  loadDotEnv();
  const sql: PgSqlClient = await connectPostgres({
    usageName: 'patch-missing-contract-abis',
    connectionArgs: getConnectionArgs(),
    connectionConfig: getConnectionConfig(),
  });

  const BATCH_SIZE = 64;
  const LAST_BLOCK_HEIGHT = parseInt(process.env.LAST_BLOCK_HEIGHT ?? '-1');

  try {
    logger.info('Starting script to patch missing contract ABIs...');

    // 2) Initialize script variables and RPC client
    let lastBlockHeight = LAST_BLOCK_HEIGHT; // Initial value for the first query

    let totalConsideredCount = 0;
    let totalPatchedCount = 0;

    const rpc = new StacksCoreRpcClient(); // Default to RPC host from ENV

    // 3) Main processing loop: Fetch and patch contracts in batches
    while (true) {
      // 3.1) Find contracts whose ABI is still missing (paginated)
      const missing = await sql<{ contract_id: string; block_height: number }[]>`
        SELECT sc.contract_id, sc.block_height
        FROM smart_contracts sc
        JOIN txs ON sc.tx_id = txs.tx_id
        WHERE (sc.abi::text = '"null"')
          AND sc.canonical = TRUE
          AND txs.canonical = TRUE
          AND txs.microblock_canonical = TRUE
          AND txs.status = 1
          AND sc.block_height > ${lastBlockHeight}
        ORDER BY sc.block_height ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (missing.length === 0) {
        if (totalConsideredCount === 0) {
          logger.info('  - No contracts with missing ABI found.');
        } else {
          logger.info(`  - Patched ${totalPatchedCount}/${totalConsideredCount} contracts.`);
        }
        break; // Exit the while loop
      }

      logger.info(`- Found batch of ${missing.length} contracts with missing ABIs.`);

      // 3.2) Process each contract in the current batch
      for (const contract of missing) {
        totalConsideredCount++;
        const { contract_id, block_height } = contract;
        const [address, name] = contract_id.split('.');
        if (!address || !name) {
          logger.warn(`  - Skipping invalid contract id: ${contract_id}`);
          continue;
        }

        try {
          // 3.3) Fetch ABI from the connected Stacks node
          const abi = await rpc.fetchJson<ClarityAbi>(`v2/contracts/interface/${address}/${name}`);

          if (!abi || typeof abi !== 'object' || Object.keys(abi).length === 0) {
            logger.warn(`  - Skipping ${contract_id}. Fetched empty or invalid ABI.`);
            continue;
          }

          if (typeof abi === 'string' && abi === 'null') {
            logger.warn(`  - Skipping ${contract_id}. Fetched "null" string ABI.`);
            continue;
          }

          // 3.4) Update row for this contract still missing an ABI
          const rows = await sql`
            UPDATE smart_contracts
              SET abi = ${abi}
            WHERE contract_id = ${contract_id}
              AND (abi::text = '"null"')
              AND canonical = TRUE
          `;
          if (rows.count === 0) {
            logger.warn(`  - Failed to patch ${contract_id}. No rows updated.`);
            continue;
          }

          logger.info(`  - Patched ABI for ${contract_id}`);
          totalPatchedCount++;
        } catch (err: any) {
          logger.error(err, `  - Failed to patch ${contract_id}`);
        }

        // Keep track of the latest block_height we've processed
        if (block_height > lastBlockHeight) {
          lastBlockHeight = block_height;
          logger.info(`  - Processed up to block ${lastBlockHeight}`);
        }
      }

      // 3.5) Check if it was the last batch
      if (missing.length < BATCH_SIZE) {
        logger.info(`  - Patched ${totalPatchedCount}/${totalConsideredCount} contracts.`);
        break; // Last batch was smaller than batch size, so no more items.
      }
    }
  } catch (err: any) {
    logger.error(err, 'An unexpected error occurred');
    throw err;
  } finally {
    // 4) Close DB connection
    logger.info('Closing database connection...');
    await sql.end({ timeout: 5 });
    logger.info('Done.');
  }
}

main().catch(err => {
  logger.error(err, 'An unexpected error occurred');
  process.exit(1);
});
