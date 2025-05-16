import { connectPostgres, PgSqlClient } from '@hirosystems/api-toolkit';
import { StacksCoreRpcClient } from '../src/core-rpc/client';
import { getConnectionArgs, getConnectionConfig } from '../src/datastore/connection';
import { ClarityAbi } from '../src/event-stream/contract-abi';
import { loadDotEnv } from '../src/helpers';

const BATCH_SIZE = 64;
const LAST_BLOCK_HEIGHT = parseInt(process.env.LAST_BLOCK_HEIGHT ?? '-1');

// 1) Environment + DB Setup
loadDotEnv();
const sql: PgSqlClient = await connectPostgres({
  usageName: 'patch-missing-contract-abis',
  connectionArgs: getConnectionArgs(),
  connectionConfig: getConnectionConfig(),
});

try {
  console.log('Starting script to patch missing contract ABIs...');

  // 2) Initialize script variables and RPC client
  let lastBlockHeight = LAST_BLOCK_HEIGHT; // Initial value for the first query

  let totalConsideredCount = 0;
  let totalPatchedCount = 0;

  const rpc = new StacksCoreRpcClient(); // Default to RPC host from ENV

  // 3) Main processing loop: Fetch and patch contracts in batches
  while (true) {
    // 3.1) Find contracts whose ABI is still missing (paginated)
    const missing = await sql<{ contract_id: string; block_height: number }[]>`
      SELECT contract_id, block_height
      FROM smart_contracts
      WHERE (abi::text = '"null"')
        AND canonical = TRUE
        AND block_height > ${lastBlockHeight}
      ORDER BY block_height ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (missing.length === 0) {
      if (totalConsideredCount === 0) {
        console.log('  - No contracts with missing ABI found.');
      } else {
        console.log(`  - Patched ${totalPatchedCount}/${totalConsideredCount} contracts.`);
      }
      break; // Exit the while loop
    }

    console.log(`- Found batch of ${missing.length} contracts with missing ABIs.`);

    // 3.2) Process each contract in the current batch
    for (const contract of missing) {
      totalConsideredCount++;
      const { contract_id, block_height } = contract;
      const [address, name] = contract_id.split('.');
      if (!address || !name) {
        console.warn(`  - Skipping invalid contract id: ${contract_id}`);
        continue;
      }

      try {
        // 3.3) Fetch ABI from the connected Stacks node
        const abi = await rpc.fetchJson<ClarityAbi>(`v2/contracts/interface/${address}/${name}`);

        if (!abi || typeof abi !== 'object' || Object.keys(abi).length === 0) {
          console.warn(`  - Skipping ${contract_id}. Fetched empty or invalid ABI.`);
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
          console.warn(`  - Failed to patch ${contract_id}. No rows updated.`);
          continue;
        }
        console.log(`  - Patched ABI for ${contract_id}`);
        totalPatchedCount++;
      } catch (err: any) {
        let errorMessage = 'Unknown error';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (typeof err === 'string') {
          errorMessage = err;
        } else if (err && typeof err.message === 'string') {
          errorMessage = err.message;
        }
        console.error(`  - Failed to patch ${contract_id}:`, errorMessage);
      }

      // Keep track of the latest block_height we've processed
      if (block_height > lastBlockHeight) {
        lastBlockHeight = block_height;
        console.log(`  - Processed up to block ${lastBlockHeight}`);
      }
    }

    // 3.5) Check if it was the last batch
    if (missing.length < BATCH_SIZE) {
      console.log(`  - Patched ${totalPatchedCount}/${totalConsideredCount} contracts.`);
      break; // Last batch was smaller than batchSize, so no more items.
    }
  }
} catch (err: any) {
  console.error('An unexpected error occurred:', err);
  if (err instanceof Error && err.stack) console.error('Stack trace:', err.stack);
  if (err instanceof Error && err.message) console.error('Error message:', err.message);
  process.exit(1); // Exit with error if an unhandled exception occurs in the main block
} finally {
  // 4) Close DB connection
  console.log('Closing database connection...');
  await sql.end({ timeout: 5 });
  console.log('Done.');
}
