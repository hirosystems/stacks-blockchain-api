import { EventEmitter } from 'events';
import { Pool, PoolClient, ClientConfig, Client, QueryResult, ClientBase } from 'pg';
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
  DbEventTypeId,
  DataStoreUpdateData,
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

const TX_COLUMNS = `
  -- required columns
  tx_id, tx_index, block_hash, block_height, burn_block_time, type_id, status, 
  canonical, post_conditions, fee_rate, sponsored, sender_address, origin_hash_mode,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload
`;

interface TxQueryResult {
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
}

export class PgDataStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly pool: Pool;
  private constructor(pool: Pool) {
    // eslint-disable-next-line constructor-super
    super();
    this.pool = pool;
  }

  async update(data: DataStoreUpdateData): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.updateBlock(client, data.block);
      for (const tx of data.txs) {
        await this.updateTx(client, tx);
      }
      for (const stxEvent of data.stxEvents) {
        await this.updateStxEvent(client, stxEvent);
      }
      for (const ftEvent of data.ftEvents) {
        await this.updateFtEvent(client, ftEvent);
      }
      for (const nftEvent of data.nftEvents) {
        await this.updateNftEvent(client, nftEvent);
      }
      for (const contractLog of data.contractLogEvents) {
        await this.updateSmartContractEvent(client, contractLog);
      }
      for (const smartContract of data.smartContracts) {
        await this.updateSmartContract(client, smartContract);
      }
      await client.query('COMMIT');
      this.emit('blockUpdate', data.block);
      data.txs.forEach(tx => {
        this.emit('txUpdate', tx);
      });
    } catch (error) {
      console.error(`Error performing PG update: ${error}`);
      console.error(error);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
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

  async updateBlock(client: ClientBase, block: DbBlock): Promise<void> {
    await client.query(
      `
      INSERT INTO blocks(
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
      ) values($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(block_hash)
      DO UPDATE SET
        index_block_hash = $2, parent_block_hash = $3, parent_microblock = $4, block_height = $5, burn_block_time = $6, canonical = $7
      `,
      [
        hexToBuffer(block.block_hash),
        hexToBuffer(block.index_block_hash),
        hexToBuffer(block.parent_block_hash),
        hexToBuffer(block.parent_microblock),
        block.block_height,
        block.burn_block_time,
        block.canonical,
      ]
    );
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
      SELECT 
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
      FROM blocks
      WHERE block_hash = $1
      `,
      [hexToBuffer(blockHash)]
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

  getBlocks(): Promise<{ results: DbBlock[] }> {
    throw new NotImplementedError('Method not implemented.');
  }

  async updateTx(client: ClientBase, tx: DbTx): Promise<void> {
    await client.query(
      `
      INSERT INTO txs(
        ${TX_COLUMNS}
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      `,
      [
        hexToBuffer(tx.tx_id),
        tx.tx_index,
        hexToBuffer(tx.block_hash),
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
  }

  parseTxQueryResult(result: TxQueryResult): DbTx {
    const tx: DbTx = {
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      block_hash: bufferToHexPrefixString(result.block_hash),
      block_height: result.block_height,
      burn_block_time: result.burn_block_time,
      type_id: result.type_id as DbTxTypeId,
      status: result.status,
      canonical: result.canonical,
      post_conditions: result.post_conditions,
      fee_rate: BigInt(result.fee_rate),
      sponsored: result.sponsored,
      sender_address: result.sender_address,
      origin_hash_mode: result.origin_hash_mode,
    };
    if (tx.type_id === DbTxTypeId.TokenTransfer) {
      tx.token_transfer_recipient_address = result.token_transfer_recipient_address;
      tx.token_transfer_amount = BigInt(result.token_transfer_amount);
      tx.token_transfer_memo = result.token_transfer_memo;
    } else if (tx.type_id === DbTxTypeId.SmartContract) {
      tx.smart_contract_contract_id = result.smart_contract_contract_id;
      tx.smart_contract_source_code = result.smart_contract_source_code;
    } else if (tx.type_id === DbTxTypeId.ContractCall) {
      tx.contract_call_contract_id = result.contract_call_contract_id;
      tx.contract_call_function_name = result.contract_call_function_name;
      tx.contract_call_function_args = result.contract_call_function_args;
    } else if (tx.type_id === DbTxTypeId.PoisonMicroblock) {
      tx.poison_microblock_header_1 = result.poison_microblock_header_1;
      tx.poison_microblock_header_2 = result.poison_microblock_header_2;
    } else if (tx.type_id === DbTxTypeId.Coinbase) {
      tx.coinbase_payload = result.coinbase_payload;
    } else {
      throw new Error(`Received unexpected tx type_id from db query: ${tx.type_id}`);
    }
    return tx;
  }

  async getTx(txId: string): Promise<DbTx> {
    const result = await this.pool.query<TxQueryResult>(
      `
      SELECT ${TX_COLUMNS}
      FROM txs
      WHERE tx_id = $1
      `,
      [hexToBuffer(txId)]
    );
    const row = result.rows[0];
    const tx = this.parseTxQueryResult(row);
    return tx;
  }

  async getTxList(count = 50): Promise<{ results: DbTx[] }> {
    const result = await this.pool.query<TxQueryResult>(
      `
      SELECT ${TX_COLUMNS}
      FROM txs
      WHERE canonical = true
      ORDER BY block_height DESC, tx_index DESC
      LIMIT $1
      `,
      [count]
    );
    const parsed = result.rows.map(r => this.parseTxQueryResult(r));
    return { results: parsed };
  }

  async getTxEvents(txId: string): Promise<DbEvent[]> {
    const client = await this.pool.connect();
    const txIdBuffer = hexToBuffer(txId);
    try {
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        value: Buffer;
      }>(
        `
        SELECT 
          event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value 
        FROM nft_events WHERE tx_id = $1 AND canonical = true
        `,
        [txIdBuffer]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount: string;
      }>(
        `
        SELECT 
          event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount 
        FROM ft_events WHERE tx_id = $1 AND canonical = true
        `,
        [txIdBuffer]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT 
          event_index, tx_id, block_height, canonical, contract_identifier, topic, value 
        FROM contract_logs WHERE tx_id = $1 AND canonical = true
        `,
        [txIdBuffer]
      );
      const events = new Array<DbEvent>(
        nftResults.rowCount + ftResults.rowCount + logResults.rowCount
      );
      let rowIndex = 0;
      for (const result of nftResults.rows) {
        const event: DbNftEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          block_height: result.block_height,
          canonical: result.canonical,
          asset_event_type_id: result.asset_event_type_id,
          sender: result.sender,
          recipient: result.recipient,
          asset_identifier: result.asset_identifier,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          value: result.value,
        };
        events[rowIndex++] = event;
      }
      for (const result of ftResults.rows) {
        const event: DbFtEvent | DbStxEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          block_height: result.block_height,
          canonical: result.canonical,
          asset_event_type_id: result.asset_event_type_id,
          sender: result.sender,
          recipient: result.recipient,
          asset_identifier: result.asset_identifier,
          event_type:
            result.asset_identifier === 'stx'
              ? DbEventTypeId.StxAsset
              : DbEventTypeId.FungibleTokenAsset,
          amount: BigInt(result.amount),
        };
        events[rowIndex++] = event;
      }
      for (const result of logResults.rows) {
        const event: DbSmartContractEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          block_height: result.block_height,
          canonical: result.canonical,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: result.contract_identifier,
          topic: result.topic,
          value: result.value,
        };
        events[rowIndex++] = event;
      }
      events.sort((a, b) => a.event_index - b.event_index);
      return events;
    } finally {
      client.release();
    }
  }

  async updateStxEvent(client: ClientBase, event: DbStxEvent): Promise<void> {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        'stx',
        event.amount,
      ]
    );
  }

  async updateFtEvent(client: ClientBase, event: DbFtEvent): Promise<void> {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.amount,
      ]
    );
  }

  async updateNftEvent(client: ClientBase, event: DbNftEvent): Promise<void> {
    await client.query(
      `
      INSERT INTO nft_events(
        event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.value,
      ]
    );
  }

  async updateSmartContractEvent(client: ClientBase, event: DbSmartContractEvent): Promise<void> {
    await client.query(
      `
      INSERT INTO contract_logs(
        event_index, tx_id, block_height, canonical, contract_identifier, topic, value
      ) values($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        event.canonical,
        event.contract_identifier,
        event.topic,
        event.value,
      ]
    );
  }

  async updateSmartContract(client: ClientBase, smartContract: DbSmartContract): Promise<void> {
    await client.query(
      `
      INSERT INTO smart_contracts(
        tx_id, canonical, contract_id, block_height, source_code, abi
      ) values($1, $2, $3, $4, $5, $6)
      `,
      [
        hexToBuffer(smartContract.tx_id),
        smartContract.canonical,
        smartContract.contract_id,
        smartContract.block_height,
        smartContract.source_code,
        smartContract.abi,
      ]
    );
  }

  async getSmartContract(contractId: string): Promise<DbSmartContract> {
    const result = await this.pool.query<{
      tx_id: Buffer;
      canonical: boolean;
      contract_id: string;
      block_height: number;
      source_code: string;
      abi: string;
    }>(
      `
      SELECT tx_id, canonical, contract_id, block_height, source_code, abi
      FROM smart_contracts
      WHERE contract_id = $1
      ORDER BY block_height DESC
      `,
      [contractId]
    );
    function parseContractQuery(row: typeof result.rows[0]): DbSmartContract {
      const smartContract: DbSmartContract = {
        tx_id: bufferToHexPrefixString(row.tx_id),
        canonical: row.canonical,
        contract_id: row.contract_id,
        block_height: row.block_height,
        source_code: row.source_code,
        abi: row.abi,
      };
      return smartContract;
    }
    if (result.rowCount === 0) {
      throw new Error('not found');
    } else if (result.rowCount === 1) {
      return parseContractQuery(result.rows[0]);
    }
    const canonicalRows = result.rows.filter(r => r.canonical);
    if (canonicalRows.length === 1 || canonicalRows.length === 0) {
      return parseContractQuery(canonicalRows[0]);
    } else {
      throw new Error(`more than one canonical contract found for ${contractId}`);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
