/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StacksNetwork } from '@stacks/network';
import { decodeBtcAddress } from '@stacks/stacking';
import {
  bufferCV,
  ClarityValue,
  getAddressFromPrivateKey,
  serializeCV,
  TransactionVersion,
  TupleCV,
  tupleCV,
} from '@stacks/transactions';
import { RPCClient } from 'rpc-bitcoin';
import codec from '@stacks/codec';
const { ClarityTypeID, decodeClarityValue } = codec;
type NativeClarityValue = codec.ClarityValue;
import supertest from 'supertest';
import { ApiServer } from '../src/api/init.js';
import { CoreRpcPoxInfo, StacksCoreRpcClient } from '../src/core-rpc/client.js';
import { DbBlock, DbTx, DbTxStatus } from '../src/datastore/common.js';
import { PgWriteStore } from '../src/datastore/pg-write-store.js';
import { BitcoinAddressFormat, ECPair, getBitcoinAddressFromKey } from '../src/ec-helpers.js';
import {
  coerceToBuffer,
  connectPostgres,
  PgConnectionArgs,
  runMigrations,
  timeout,
} from '@stacks/api-toolkit';
import { MIGRATIONS_DIR } from '../src/datastore/pg-store.js';
import { getConnectionArgs } from '../src/datastore/connection.js';
import { AddressStxBalance } from '../src/api/schemas/entities/addresses.js';
import { ServerStatusResponse } from '../src/api/schemas/responses/responses.js';
import { FAUCET_TESTNET_KEYS } from '../src/api/routes/faucets.js';
import { ENV } from '../src/env.js';
import { EventStreamServer } from '../src/event-stream/event-server.js';

export async function migrate(direction: 'up' | 'down') {
  ENV.PG_DATABASE = 'postgres';
  const connArgs = getConnectionArgs();
  await createSchema(connArgs);
  await runMigrations(MIGRATIONS_DIR, direction, connArgs);
}

export function createClarityValueArray(...input: ClarityValue[]): Buffer {
  const buffers = new Array<Buffer>(input.length);
  for (let i = 0; i < input.length; i++) {
    buffers[i] = Buffer.from(serializeCV(input[i]));
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
