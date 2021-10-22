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

async function getTopAccounts() {
  const db = await PgDataStore.connect(true);

  const blockHeight = await db.query(async client => {
    return await db.getChainTip(client);
  });
  const addressBalances = await db.query(async client => {
    const result = await client.query<AddressBalanceResult>(`
      WITH addresses AS ((
        SELECT
          sender AS address
        FROM
          stx_events
        WHERE
          sender IS NOT NULL)
      UNION ALL (
        SELECT
          recipient AS address
        FROM
          stx_events
        WHERE
          recipient IS NOT NULL)
      )
      SELECT
        COUNT(*) AS count, address
      FROM
        addresses
      GROUP BY
        address
      ORDER BY
        count DESC
      LIMIT 10;
    `);
    return result.rows;
  });
  await Promise.all(
    addressBalances.map(async item => {
      const balance = await db.getStxBalanceAtBlock(item.address, blockHeight.blockHeight);
      item.apiBalance = balance.balance;
    })
  );

  const tabularData: (string | number | bigint | undefined)[][] = [
    ['event count', 'address', 'api balance', 'node balance'],
  ];
  addressBalances.forEach(item => {
    tabularData.push([item.count, item.address, item.apiBalance, item.nodeBalance]);
  });
  console.log(table(tabularData));

  await db.close();
}

async function handleProgramArgs() {
  const parsedOpts = getopts(process.argv.slice(2), {
    boolean: [],
  });
  const args = {
    operand: parsedOpts._[0],
    options: parsedOpts,
  } as {
    operand: 'stx-balances';
    options: {
      ['count']?: number;
    };
  };

  if (args.operand === 'stx-balances') {
    await getTopAccounts();
  } else if (parsedOpts._[0]) {
    throw new Error(`Unexpected program argument: ${parsedOpts._[0]}`);
  }
}

dotenv.config({ path: '../.env' });
void handleProgramArgs().catch(error => {
  console.error(error);
  process.exit(1);
});
