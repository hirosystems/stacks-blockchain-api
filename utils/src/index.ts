import * as dotenv from 'dotenv';
import * as getopts from 'getopts';
import * as bigint from 'extra-bigint';
import { table } from 'table';
import { StacksCoreRpcClient } from '../../src/core-rpc/client';
import { PgDataStore } from '../../src/datastore/postgres-store';

type AddressBalanceResult = {
  count: number;
  address: string;
  apiBalance?: bigint;
  nodeBalance?: bigint;
};

type BlockInfo = {
  block_height: number;
  block_hash: Buffer;
  index_block_hash: Buffer;
};

type TableCellValue = string | number | bigint | undefined;

/**
 * Prints the account balance as reported by the local DB and the Stacks node of the `count`
 * accounts with the greatest number of STX transfer events.
 * @param count Number of top accounts to query
 * @param blockHeight Specific block height at which to query balances
 */
async function printTopAccountBalances(count: number, blockHeight: number) {
  const db = await PgDataStore.connect({ skipMigrations: true, usageName: 'tests' });

  const heightText = blockHeight == 0 ? 'chain tip' : `block height ${blockHeight}`;
  console.log(`Calculating balances for top ${count} accounts at ${heightText}...`);
  const blockInfo = await db.query(async client => {
    const result = await client.query<BlockInfo>(
      `
      SELECT block_height, block_hash, index_block_hash
      FROM blocks
      WHERE canonical = true AND block_height = (
        CASE
          WHEN $1=0 THEN (SELECT MAX(block_height) FROM blocks)
          ELSE $1
        END
      )
      `,
      [blockHeight]
    );
    return result.rows[0];
  });
  // First, get the top addresses.
  const addressBalances = await db.query(async client => {
    const result = await client.query<AddressBalanceResult>(
      `
      WITH addresses AS ((
        SELECT
          sender AS address
        FROM
          stx_events
        WHERE
          sender IS NOT NULL
          AND block_height <= $1)
      UNION ALL (
        SELECT
          recipient AS address
        FROM
          stx_events
        WHERE
          recipient IS NOT NULL
          AND block_height <= $1)
      )
      SELECT
        COUNT(*) AS count, address
      FROM
        addresses
      GROUP BY
        address
      ORDER BY
        count DESC
      LIMIT $2;
      `,
      [blockInfo.block_height, count]
    );
    return result.rows;
  });
  // Next, fill them up with balances from DB and node.
  const dbBalances = addressBalances.map(async item => {
    const balance = await db.getStxBalanceAtBlock(item.address, blockInfo.block_height);
    item.apiBalance = balance.balance;
  });
  const nodeBalances = addressBalances.map(async item => {
    const account = await new StacksCoreRpcClient().getAccount(
      item.address,
      false,
      blockInfo.index_block_hash.toString('hex')
    );
    item.nodeBalance = BigInt(account.balance) + BigInt(account.locked);
  });
  await Promise.all(dbBalances.concat(nodeBalances));

  const tabularData: TableCellValue[][] = [
    ['event count', 'address', 'api balance', 'node balance', 'delta'],
  ];
  addressBalances.forEach(item => {
    tabularData.push([
      item.count,
      item.address,
      item.apiBalance,
      item.nodeBalance,
      bigint.abs((item.apiBalance ?? BigInt(0)) - (item.nodeBalance ?? BigInt(0))),
    ]);
  });
  console.log(table(tabularData));

  await db.close();
}

function printUsage() {
  console.log(`Usage:`);
  console.log(`  node ./index.js stx-balances [--count=<count>] [--block-height=<height>]`);
}

async function handleProgramArgs() {
  const parsedOpts = getopts(process.argv.slice(2));
  const args = {
    operand: parsedOpts._[0],
    options: parsedOpts,
  } as {
    operand: 'stx-balances';
    options: {
      ['count']?: number;
      ['block-height']?: number;
    };
  };

  if (args.operand === 'stx-balances') {
    await printTopAccountBalances(args.options.count ?? 10, args.options['block-height'] ?? 0);
  } else if (parsedOpts._[0]) {
    printUsage();
    throw new Error(`Unexpected program argument: ${parsedOpts._[0]}`);
  } else {
    printUsage();
  }
}

dotenv.config({ path: '../.env' });
void handleProgramArgs().catch(error => {
  console.error(error);
  process.exit(1);
});
