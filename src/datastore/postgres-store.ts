import * as path from 'path';
import { EventEmitter } from 'events';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import { Pool, PoolClient, ClientConfig, Client, ClientBase } from 'pg';

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

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(APP_DIR, 'migrations');

export function getPgClientConfig(): ClientConfig {
  const config: ClientConfig = {
    database: process.env['PG_DATABASE'],
    user: process.env['PG_USER'],
    password: process.env['PG_PASSWORD'],
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
    const runnerOpts: RunnerOption = {
      dbClient: client,
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
      log: log,
    };
    if (process.env['PG_SCHEMA']) {
      runnerOpts.schema = process.env['PG_SCHEMA'];
    }
    await PgMigrate(runnerOpts);
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
  tx_id, tx_index, index_block_hash, block_hash, block_height, burn_block_time, type_id, status, 
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

const BLOCK_COLUMNS = `
  block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
`;

interface BlockQueryResult {
  block_hash: Buffer;
  index_block_hash: Buffer;
  parent_block_hash: Buffer;
  parent_microblock: Buffer;
  block_height: number;
  burn_block_time: number;
  canonical: boolean;
}

interface TxQueryResult {
  tx_id: Buffer;
  tx_index: number;
  index_block_hash: Buffer;
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
      await this.handleReorg(client, data.block);
      const blocksUpdated = await this.updateBlock(client, data.block);
      if (blocksUpdated !== 0) {
        for (const entry of data.txs) {
          await this.updateTx(client, entry.tx);
          for (const stxEvent of entry.stxEvents) {
            await this.updateStxEvent(client, entry.tx, stxEvent);
          }
          for (const ftEvent of entry.ftEvents) {
            await this.updateFtEvent(client, entry.tx, ftEvent);
          }
          for (const nftEvent of entry.nftEvents) {
            await this.updateNftEvent(client, entry.tx, nftEvent);
          }
          for (const contractLog of entry.contractLogEvents) {
            await this.updateSmartContractEvent(client, entry.tx, contractLog);
          }
          for (const smartContract of entry.smartContracts) {
            await this.updateSmartContract(client, entry.tx, smartContract);
          }
        }
      }
      await client.query('COMMIT');
      this.emit('blockUpdate', data.block);
      data.txs.forEach(entry => {
        this.emit('txUpdate', entry.tx);
      });
    } catch (error) {
      console.error(`Error performing PG update: ${error}`);
      console.error(error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async handleReorg(
    client: ClientBase,
    block: DbBlock
  ): Promise<{
    blocks: number;
    txs: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
  } | null> {
    // Detect reorg event by checking for existing block with same height.
    const result = await client.query<{ index_block_hash: Buffer }>(
      `
      SELECT index_block_hash 
      FROM blocks 
      WHERE canonical = true AND block_height = $1 AND index_block_hash != $2
      LIMIT 1
      `,
      [block.block_height, hexToBuffer(block.index_block_hash)]
    );

    if (result.rowCount === 0) {
      // No conflicting chain state, no reorg required.
      return null;
    }

    // Reorg required, update every canonical entity with greater block height as non-canonical.
    // Note: this is not very DRY looking, but it's likely these tables will require unique query tuning in the future.
    const blockResult = await client.query(
      `
      UPDATE blocks
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${blockResult.rowCount} blocks as non-canonical`);
    const txResult = await client.query(
      `
      UPDATE txs
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    const stxResults = await client.query(
      `
      UPDATE stx_events
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${stxResults.rowCount} stx-token events as non-canonical`);
    const ftResult = await client.query(
      `
      UPDATE ft_events
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${ftResult.rowCount} fungible-tokens events as non-canonical`);
    const nftResult = await client.query(
      `
      UPDATE nft_events
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${nftResult.rowCount} non-fungible-tokens events as non-canonical`);
    const contractLogResult = await client.query(
      `
      UPDATE contract_logs
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${contractLogResult.rowCount} contract logs as non-canonical`);
    const smartContractResult = await client.query(
      `
      UPDATE smart_contracts
      SET canonical = false
      WHERE block_height >= $1 AND canonical = true
      `,
      [block.block_height]
    );
    console.log(`Marked ${smartContractResult.rowCount} smart contracts as non-canonical`);
    return {
      blocks: blockResult.rowCount,
      txs: txResult.rowCount,
      stxEvents: stxResults.rowCount,
      ftEvents: ftResult.rowCount,
      nftEvents: nftResult.rowCount,
      contractLogs: contractLogResult.rowCount,
      smartContracts: smartContractResult.rowCount,
    };
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

  async updateBlock(client: ClientBase, block: DbBlock): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO blocks(
        block_hash, index_block_hash, parent_block_hash, parent_microblock, block_height, burn_block_time, canonical
      ) values($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (index_block_hash)
      DO NOTHING
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
    return result.rowCount;
  }

  parseBlockQueryResult(row: BlockQueryResult): DbBlock {
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

  async getBlock(blockHash: string) {
    const result = await this.pool.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE block_hash = $1
      ORDER BY canonical DESC, block_height DESC
      LIMIT 1
      `,
      [hexToBuffer(blockHash)]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlocks(count: 50) {
    const result = await this.pool.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE canonical = true
      ORDER BY block_height DESC
      LIMIT $1
      `,
      [count]
    );
    const parsed = result.rows.map(r => this.parseBlockQueryResult(r));
    return { results: parsed } as const;
  }

  async updateTx(client: ClientBase, tx: DbTx): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO txs(
        ${TX_COLUMNS}
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash
      DO NOTHING
      `,
      [
        hexToBuffer(tx.tx_id),
        tx.tx_index,
        hexToBuffer(tx.index_block_hash),
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
    return result.rowCount;
  }

  parseTxQueryResult(result: TxQueryResult): DbTx {
    const tx: DbTx = {
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      index_block_hash: bufferToHexPrefixString(result.index_block_hash),
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

  async getTx(txId: string) {
    const result = await this.pool.query<TxQueryResult>(
      `
      SELECT ${TX_COLUMNS}
      FROM txs
      WHERE tx_id = $1
      ORDER BY canonical DESC, block_height DESC
      LIMIT 1
      `,
      [hexToBuffer(txId)]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const tx = this.parseTxQueryResult(row);
    return { found: true, result: tx };
  }

  async getTxList({ limit, offset }: { limit: number; offset: number }) {
    const totalQuery = this.pool.query(`
      SELECT COUNT(*)
      FROM txs
      WHERE canonical = true
    `);
    const resultQuery = this.pool.query<TxQueryResult>(
      `
      SELECT ${TX_COLUMNS}
      FROM txs
      WHERE canonical = true
      ORDER BY block_height DESC, tx_index DESC
      LIMIT $1
      OFFSET $2
      `,
      [limit, offset]
    );
    const [total, results] = await Promise.all([totalQuery, resultQuery]);
    const parsed = results.rows.map(r => this.parseTxQueryResult(r));
    return { results: parsed, total: parseInt(total.rows[0].count, 10) };
  }

  async getTxEvents(txId: string, indexBlockHash: string) {
    const client = await this.pool.connect();
    const txIdBuffer = hexToBuffer(txId);
    const blockHashBuffer = hexToBuffer(indexBlockHash);
    try {
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT 
          event_index, tx_id, block_height, canonical, asset_event_type_id, sender, recipient, amount 
        FROM stx_events 
        WHERE tx_id = $1 AND index_block_hash = $2
        `,
        [txIdBuffer, blockHashBuffer]
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
        FROM ft_events 
        WHERE tx_id = $1 AND index_block_hash = $2
        `,
        [txIdBuffer, blockHashBuffer]
      );
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
        FROM nft_events 
        WHERE tx_id = $1 AND index_block_hash = $2
        `,
        [txIdBuffer, blockHashBuffer]
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
        FROM contract_logs 
        WHERE tx_id = $1 AND index_block_hash = $2
        `,
        [txIdBuffer, blockHashBuffer]
      );
      const events = new Array<DbEvent>(
        nftResults.rowCount + ftResults.rowCount + logResults.rowCount
      );
      let rowIndex = 0;
      for (const result of stxResults.rows) {
        const event: DbStxEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          block_height: result.block_height,
          canonical: result.canonical,
          asset_event_type_id: result.asset_event_type_id,
          sender: result.sender,
          recipient: result.recipient,
          event_type: DbEventTypeId.StxAsset,
          amount: BigInt(result.amount),
        };
        events[rowIndex++] = event;
      }
      for (const result of ftResults.rows) {
        const event: DbFtEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          block_height: result.block_height,
          canonical: result.canonical,
          asset_event_type_id: result.asset_event_type_id,
          sender: result.sender,
          recipient: result.recipient,
          asset_identifier: result.asset_identifier,
          event_type: DbEventTypeId.FungibleTokenAsset,
          amount: BigInt(result.amount),
        };
        events[rowIndex++] = event;
      }
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
      return { results: events };
    } finally {
      client.release();
    }
  }

  async updateStxEvent(client: ClientBase, tx: DbTx, event: DbStxEvent) {
    await client.query(
      `
      INSERT INTO stx_events(
        event_index, tx_id, block_height, index_block_hash, canonical, asset_event_type_id, sender, recipient, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.amount,
      ]
    );
  }

  async updateFtEvent(client: ClientBase, tx: DbTx, event: DbFtEvent) {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, block_height, index_block_hash, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.amount,
      ]
    );
  }

  async updateNftEvent(client: ClientBase, tx: DbTx, event: DbNftEvent) {
    await client.query(
      `
      INSERT INTO nft_events(
        event_index, tx_id, block_height, index_block_hash, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.value,
      ]
    );
  }

  async updateSmartContractEvent(client: ClientBase, tx: DbTx, event: DbSmartContractEvent) {
    await client.query(
      `
      INSERT INTO contract_logs(
        event_index, tx_id, block_height, index_block_hash, canonical, contract_identifier, topic, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.contract_identifier,
        event.topic,
        event.value,
      ]
    );
  }

  async updateSmartContract(client: ClientBase, tx: DbTx, smartContract: DbSmartContract) {
    await client.query(
      `
      INSERT INTO smart_contracts(
        tx_id, canonical, contract_id, block_height, index_block_hash, source_code, abi
      ) values($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        hexToBuffer(smartContract.tx_id),
        smartContract.canonical,
        smartContract.contract_id,
        smartContract.block_height,
        hexToBuffer(tx.index_block_hash),
        smartContract.source_code,
        smartContract.abi,
      ]
    );
  }

  async getSmartContract(contractId: string) {
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
      ORDER BY canonical DESC, block_height DESC
      LIMIT 1
      `,
      [contractId]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const smartContract: DbSmartContract = {
      tx_id: bufferToHexPrefixString(row.tx_id),
      canonical: row.canonical,
      contract_id: row.contract_id,
      block_height: row.block_height,
      source_code: row.source_code,
      abi: row.abi,
    };
    return { found: true, result: smartContract };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
