import { EventEmitter } from 'events';
import { Pool, PoolClient, ClientConfig, Client } from 'pg';
import {
  parsePort,
  getCurrentGitTag,
  APP_DIR,
  isTestEnv,
  isDevEnv,
  bufferToHexPrefixString,
  hexToBuffer,
  stopwatch,
  timeout,
} from '../helpers';
import {
  DataStore,
  DbBlock,
  DbTx,
  DbStxEvent,
  DbFtEvent,
  DbNftEvent,
  DbTxTypeId,
  DbSmartContractEvent,
  DbSmartContract,
  DbEvent,
  DataStoreEventEmitter,
} from './common';
import PgMigrate from 'node-pg-migrate';
import * as path from 'path';
import { NotImplementedError } from '../errors';

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(APP_DIR, 'migrations');

export function getPgClientConfig(): ClientConfig {
  const config: ClientConfig = {
    database: process.env['PG_DATABASE'],
    user: process.env['PG_USER'],
    password: process.env['PG_USER'],
    host: process.env['PG_HOST'],
    port: parsePort(process.env['PG_PORT']),
  };
  return config;
}

export async function runMigrations(
  clientConfig: ClientConfig = getPgClientConfig(),
  direction: 'up' | 'down' = 'up',
  log?: (msg: string) => void
): Promise<void> {
  if (direction !== 'up' && !isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
  clientConfig = clientConfig ?? getPgClientConfig();
  const client = new Client(clientConfig);
  try {
    await client.connect();
    await PgMigrate({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
      log: log,
    });
  } catch (error) {
    console.error(`Error running pg-migrate`);
    console.error(error);
  } finally {
    await client.end();
  }
}

export async function cycleMigrations(): Promise<void> {
  const clientConfig = getPgClientConfig();
  await runMigrations(clientConfig, 'down', () => {});
  await runMigrations(clientConfig, 'up', () => {});
}

/**
 * Reformats a `0x` prefixed hex string to the PG `\\x` prefix format.
 * @param hex - A hex string with a `0x` prefix.
 */
function formatPgHexString(hex: string): string {
  const buff = hexToBuffer(hex);
  return formatPgHexBuffer(buff);
}

function formatPgHexBuffer(buff: Buffer): string {
  return '\\x' + buff.toString('hex');
}

export class PgDataStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  private readonly pool: Pool;
  private constructor(pool: Pool) {
    // eslint-disable-next-line constructor-super
    super();
    this.pool = pool;
  }

  static async connect(): Promise<PgDataStore> {
    const clientConfig = getPgClientConfig();

    const initTimer = stopwatch();
    let connectionError: Error;
    let connectionOkay = false;
    do {
      const client = new Client(clientConfig);
      try {
        await client.connect();
        connectionOkay = true;
        break;
      } catch (error) {
        if (
          error.code !== 'ECONNREFUSED' &&
          error.message !== 'Connection terminated unexpectedly'
        ) {
          console.error('Cannot connect to pg');
          throw error;
        }
        console.error('Pg connection failed, retrying in 2000ms..');
        connectionError = error;
        await timeout(2000);
      } finally {
        client.end(() => {});
      }
    } while (initTimer.getElapsed() < 10000);
    if (!connectionOkay) {
      connectionError = connectionError! ?? new Error('Error connecting to database');
      throw connectionError;
    }

    await runMigrations(clientConfig);
    const pool = new Pool({
      ...clientConfig,
      application_name: `stacks-core-sidecar-${getCurrentGitTag()}`,
    });
    let poolClient: PoolClient | undefined;
    try {
      poolClient = await pool.connect();
      return new PgDataStore(pool);
    } catch (error) {
      console.error(`Error connecting to Postgres using ${JSON.stringify(clientConfig)}: ${error}`);
      console.error(error);
      throw error;
    } finally {
      poolClient?.release();
    }
  }

  async updateBlock(block: DbBlock): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        insert into blocks(
          block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
        ) values($1, $2, $3, $4, $5, $6, $7)
        on conflict(block_hash)
        do update set 
          index_block_hash = $2, parent_block_hash = $3, parent_microblock = $4, block_height = $5, burn_block_time = $6, canonical = $7
        `,
        [
          formatPgHexString(block.block_hash),
          formatPgHexString(block.index_block_hash),
          formatPgHexString(block.parent_block_hash),
          formatPgHexString(block.parent_microblock),
          block.block_height,
          block.burn_block_time,
          block.canonical,
        ]
      );
      this.emit('blockUpdate', block);
    } finally {
      client.release();
    }
  }

  async getBlock(blockHash: string): Promise<DbBlock> {
    const result = await this.pool.query<{
      block_hash: Buffer;
      index_block_hash: Buffer;
      parent_block_hash: Buffer;
      parent_microblock: Buffer;
      block_height: number;
      burn_block_time: number;
      canonical: boolean;
    }>(
      `
      select 
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
      from blocks
      where block_hash = $1
      `,
      [formatPgHexString(blockHash)]
    );
    const row = result.rows[0];
    const block: DbBlock = {
      block_hash: bufferToHexPrefixString(row.block_hash),
      index_block_hash: bufferToHexPrefixString(row.index_block_hash),
      parent_block_hash: bufferToHexPrefixString(row.parent_block_hash),
      parent_microblock: bufferToHexPrefixString(row.parent_microblock),
      block_height: row.block_height,
      burn_block_time: row.burn_block_time,
      canonical: row.canonical,
    };
    return block;
  }

  async updateTx(tx: DbTx): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `
        insert into txs(
          tx_id, tx_index, block_hash, block_height, burn_block_time, type_id, status, 
          canonical, post_conditions, fee_rate, sponsored, sender_address, origin_hash_mode,

          -- token-transfer tx values
          token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

          -- smart-contract tx values
          smart_contract_contract_id, smart_contract_source_code,

          -- contract-call tx values
          contract_call_contract_id, contract_call_function_name, contract_call_function_args,

          -- poison-microblock tx values
          poison_microblock_header_1, poison_microblock_header_2,

          -- coinbase tx values
          coinbase_payload

        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        `,
        [
          formatPgHexString(tx.tx_id),
          tx.tx_index,
          formatPgHexString(tx.block_hash),
          tx.block_height,
          tx.burn_block_time,
          tx.type_id,
          tx.status,
          tx.canonical,
          tx.post_conditions,
          tx.fee_rate,
          tx.sponsored,
          tx.sender_address,
          tx.origin_hash_mode,
          tx.token_transfer_recipient_address,
          tx.token_transfer_amount,
          tx.token_transfer_memo,
          tx.smart_contract_contract_id,
          tx.smart_contract_source_code,
          tx.contract_call_contract_id,
          tx.contract_call_function_name,
          tx.contract_call_function_args,
          tx.poison_microblock_header_1,
          tx.poison_microblock_header_2,
          tx.coinbase_payload,
        ]
      );
      this.emit('txUpdate', tx);
    } finally {
      client.release();
    }
  }

  async getTx(txId: string): Promise<DbTx> {
    const result = await this.pool.query<{
      tx_id: Buffer;
      tx_index: number;
      block_hash: Buffer;
      block_height: number;
      burn_block_time: number;
      type_id: number;
      status: number;
      canonical: boolean;
      post_conditions: Buffer;
      fee_rate: string;
      sponsored: boolean;
      sender_address: string;
      origin_hash_mode: number;

      // `token_transfer` tx types
      token_transfer_recipient_address?: string;
      token_transfer_amount?: string;
      token_transfer_memo?: Buffer;

      // `smart_contract` tx types
      smart_contract_contract_id?: string;
      smart_contract_source_code?: string;

      // `contract_call` tx types
      contract_call_contract_id?: string;
      contract_call_function_name?: string;
      contract_call_function_args?: Buffer;

      // `poison_microblock` tx types
      poison_microblock_header_1?: Buffer;
      poison_microblock_header_2?: Buffer;

      // `coinbase` tx types
      coinbase_payload?: Buffer;
    }>(
      `
      select 
        tx_id, tx_index, block_hash, block_height, burn_block_time, type_id, status, 
        canonical, post_conditions, fee_rate, sponsored, sender_address, origin_hash_mode,

        -- token-transfer tx values
        token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

        -- smart-contract tx values
        smart_contract_contract_id, smart_contract_source_code,

        -- contract-call tx values
        contract_call_contract_id, contract_call_function_name, contract_call_function_args,

        -- poison-microblock tx values
        poison_microblock_header_1, poison_microblock_header_2,

        -- coinbase tx values
        coinbase_payload
      from txs
      where tx_id = $1
      `,
      [formatPgHexString(txId)]
    );
    const row = result.rows[0];
    const tx: DbTx = {
      tx_id: txId,
      tx_index: row.tx_index,
      block_hash: bufferToHexPrefixString(row.block_hash),
      block_height: row.block_height,
      burn_block_time: row.burn_block_time,
      type_id: row.type_id as DbTxTypeId,
      status: row.status,
      canonical: row.canonical,
      post_conditions: row.post_conditions,
      fee_rate: BigInt(row.fee_rate),
      sponsored: row.sponsored,
      sender_address: row.sender_address,
      origin_hash_mode: row.origin_hash_mode,
    };
    if (tx.type_id === DbTxTypeId.TokenTransfer) {
      tx.token_transfer_recipient_address = row.token_transfer_recipient_address;
      tx.token_transfer_amount = BigInt(row.token_transfer_amount);
      tx.token_transfer_memo = row.token_transfer_memo;
    } else if (tx.type_id === DbTxTypeId.SmartContract) {
      tx.smart_contract_contract_id = row.smart_contract_contract_id;
      tx.smart_contract_source_code = row.smart_contract_source_code;
    } else if (tx.type_id === DbTxTypeId.ContractCall) {
      tx.contract_call_contract_id = row.contract_call_contract_id;
      tx.contract_call_function_name = row.contract_call_function_name;
      tx.contract_call_function_args = row.contract_call_function_args;
    } else if (tx.type_id === DbTxTypeId.PoisonMicroblock) {
      tx.poison_microblock_header_1 = row.poison_microblock_header_1;
      tx.poison_microblock_header_2 = row.poison_microblock_header_2;
    } else if (tx.type_id === DbTxTypeId.Coinbase) {
      tx.coinbase_payload = row.coinbase_payload;
    } else {
      throw new Error(`Received unexpected tx type_id from db query: ${tx.type_id}`);
    }
    return tx;
  }
  getTxEvents(txId: string): Promise<DbEvent[]> {
    throw new NotImplementedError('Method not implemented.');
  }
  updateStxEvent(event: DbStxEvent): Promise<void> {
    throw new NotImplementedError('Method not implemented.');
  }
  updateFtEvent(event: DbFtEvent): Promise<void> {
    throw new NotImplementedError('Method not implemented.');
  }
  updateNftEvent(event: DbNftEvent): Promise<void> {
    throw new NotImplementedError('Method not implemented.');
  }
  updateSmartContractEvent(event: DbSmartContractEvent): Promise<void> {
    throw new NotImplementedError('Method not implemented.');
  }
  getTxList(): Promise<{ results: DbTx[] }> {
    throw new NotImplementedError('Method not implemented.');
  }
  getBlocks(): Promise<{ results: DbBlock[] }> {
    throw new NotImplementedError('Method not implemented.');
  }
  updateSmartContract(smartContract: DbSmartContract): Promise<void> {
    throw new NotImplementedError('Method not implemented.');
  }
  getSmartContract(contractId: string): Promise<DbSmartContract> {
    throw new NotImplementedError('Method not implemented.');
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
