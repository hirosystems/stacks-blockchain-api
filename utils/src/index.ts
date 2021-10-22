import * as dotenv from 'dotenv';
import * as getopts from 'getopts';
import { table } from 'table';
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
  const db = await PgDataStore.connect(true);

  const blockInfo = await db.query(async client => {
    console.log(blockHeight);
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
  await Promise.all(
    addressBalances.map(async item => {
      const balance = await db.getStxBalanceAtBlock(item.address, blockInfo.block_height);
      item.apiBalance = balance.balance;
    })
  );

  const tabularData: TableCellValue[][] = [
    ['event count', 'address', 'api balance', 'node balance'],
  ];
  addressBalances.forEach(item => {
    tabularData.push([item.count, item.address, item.apiBalance, item.nodeBalance]);
  });
  console.log(table(tabularData));

  await db.close();
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
    throw new Error(`Unexpected program argument: ${parsedOpts._[0]}`);
  } else {
    // TODO: Display usage.
    throw new Error(`Program arguments required`);
  }
}

dotenv.config({ path: '../.env' });
void handleProgramArgs().catch(error => {
  console.error(error);
  process.exit(1);
});
