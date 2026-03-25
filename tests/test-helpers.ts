import { ClarityValue, serializeCV } from '@stacks/transactions';
import { connectPostgres, PgConnectionArgs, runMigrations } from '@stacks/api-toolkit';
import { MIGRATIONS_DIR } from '../src/datastore/pg-store.js';
import { getConnectionArgs } from '../src/datastore/connection.js';
import { ENV } from '../src/env.js';

export async function migrate(direction: 'up' | 'down') {
  ENV.PG_DATABASE = 'postgres';
  const connArgs = getConnectionArgs();
  await createSchema(connArgs);
  await runMigrations(MIGRATIONS_DIR, direction, connArgs);
}

export function createClarityValueArray(...input: ClarityValue[]): Buffer {
  const buffers = new Array<Buffer>(input.length);
  for (let i = 0; i < input.length; i++) {
    const serialized = serializeCV(input[i]);
    buffers[i] =
      typeof serialized === 'string'
        ? Buffer.from(serialized.replace(/^0x/i, ''), 'hex')
        : Buffer.from(serialized);
  }
  const valueCountBuffer = Buffer.alloc(4);
  valueCountBuffer.writeUInt32BE(input.length);
  buffers.unshift(valueCountBuffer);
  return Buffer.concat(buffers);
}

export async function createSchema(connArgs: PgConnectionArgs) {
  if (typeof connArgs !== 'string' && connArgs.schema) {
    const sql = await connectPostgres({
      usageName: 'tests-migrations-setup',
      connectionArgs: connArgs,
    });
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql(connArgs.schema)}`;
    await sql.end();
  }
}
