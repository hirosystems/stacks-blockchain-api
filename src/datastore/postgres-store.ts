import * as path from 'path';
import { EventEmitter } from 'events';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import { Pool, PoolClient, ClientConfig, Client, ClientBase, QueryResult, QueryConfig } from 'pg';

import {
  parsePort,
  APP_DIR,
  isTestEnv,
  isDevEnv,
  bufferToHexPrefixString,
  hexToBuffer,
  stopwatch,
  timeout,
  logger,
  logError,
  FoundOrNot,
  getOrAdd,
  assertNotNullish,
  batchIterate,
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
  DbFaucetRequest,
  DataStoreEventEmitter,
  DbEventTypeId,
  DataStoreUpdateData,
  DbFaucetRequestCurrency,
  DbMempoolTx,
  DbMempoolTxId,
  DbSearchResult,
  DbStxBalance,
  DbStxLockEvent,
  DbFtBalance,
  DbMinerReward,
  DbBurnchainReward,
  DbInboundStxTransfer,
  DbTxStatus,
} from './common';
import { TransactionType } from '@blockstack/stacks-blockchain-api-types';
import { getTxTypeId } from '../api/controllers/db-controller';

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
  direction: 'up' | 'down' = 'up'
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
      ignorePattern: '.*map',
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
      logger: {
        info: msg => {},
        warn: msg => logger.warn(msg),
        error: msg => logger.error(msg),
      },
    };
    if (process.env['PG_SCHEMA']) {
      runnerOpts.schema = process.env['PG_SCHEMA'];
    }
    await PgMigrate(runnerOpts);
  } catch (error) {
    logError(`Error running pg-migrate`, error);
    throw error;
  } finally {
    await client.end();
  }
}

export async function cycleMigrations(): Promise<void> {
  const clientConfig = getPgClientConfig();

  await runMigrations(clientConfig, 'down');
  await runMigrations(clientConfig, 'up');
}

const TX_COLUMNS = `
  -- required columns
  tx_id, raw_tx, tx_index, index_block_hash, block_hash, block_height, burn_block_time, type_id, status, 
  canonical, post_conditions, nonce, fee_rate, sponsored, sponsor_address, sender_address, origin_hash_mode,

  -- token-transfer tx columns
  token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,

  -- smart-contract tx columns
  smart_contract_contract_id, smart_contract_source_code,

  -- contract-call tx columns
  contract_call_contract_id, contract_call_function_name, contract_call_function_args,

  -- poison-microblock tx columns
  poison_microblock_header_1, poison_microblock_header_2,

  -- coinbase tx columns
  coinbase_payload,

  -- tx result
  raw_result
`;

const MEMPOOL_TX_COLUMNS = `
  -- required columns
  pruned, tx_id, raw_tx, type_id, status, receipt_time,
  post_conditions, nonce, fee_rate, sponsored, sponsor_address, sender_address, origin_hash_mode,

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

const MEMPOOL_TX_ID_COLUMNS = `
  -- required columns
  tx_id
`;

const BLOCK_COLUMNS = `
  block_hash, index_block_hash, parent_index_block_hash, parent_block_hash, parent_microblock, block_height, 
  burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical
`;

interface BlockQueryResult {
  block_hash: Buffer;
  index_block_hash: Buffer;
  parent_index_block_hash: Buffer;
  parent_block_hash: Buffer;
  parent_microblock: Buffer;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: Buffer;
  burn_block_height: number;
  miner_txid: Buffer;
  canonical: boolean;
}

interface MempoolTxQueryResult {
  pruned: boolean;
  tx_id: Buffer;

  nonce: number;
  type_id: number;
  status: number;
  receipt_time: number;

  raw_result: Buffer;
  canonical: boolean;
  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address?: string;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

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

interface TxQueryResult {
  tx_id: Buffer;
  tx_index: number;
  index_block_hash: Buffer;
  block_hash: Buffer;
  block_height: number;
  burn_block_time: number;
  nonce: number;
  type_id: number;
  status: number;
  raw_result: Buffer;
  canonical: boolean;
  post_conditions: Buffer;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address?: string;
  sender_address: string;
  origin_hash_mode: number;
  raw_tx: Buffer;

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

interface MempoolTxIdQueryResult {
  tx_id: Buffer;
}
interface FaucetRequestQueryResult {
  currency: string;
  ip: string;
  address: string;
  occurred_at: string;
}

interface UpdatedEntities {
  markedCanonical: {
    blocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
  };
  markedNonCanonical: {
    blocks: number;
    minerRewards: number;
    txs: number;
    stxLockEvents: number;
    stxEvents: number;
    ftEvents: number;
    nftEvents: number;
    contractLogs: number;
    smartContracts: number;
  };
}

interface TransferQueryResult {
  sender: string;
  memo: Buffer;
  block_height: number;
  tx_index: number;
  tx_id: Buffer;
  transfer_type: string;
  amount: string;
}

// TODO: Disable this if/when sql leaks are found or ruled out.
const SQL_QUERY_LEAK_DETECTION = true;

function getSqlQueryString(query: QueryConfig | string): string {
  if (typeof query === 'string') {
    return query;
  } else {
    return query.text;
  }
}

export class PgDataStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly pool: Pool;
  private constructor(pool: Pool) {
    // eslint-disable-next-line constructor-super
    super();
    this.pool = pool;
  }

  /**
   * Execute queries against the connection pool.
   */
  async query<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (SQL_QUERY_LEAK_DETECTION) {
        // Monkey patch in some query leak detection. Taken from the lib's docs:
        // https://node-postgres.com/guides/project-structure
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const query = client.query;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const release = client.release;
        const lastQueries: any[] = [];
        const timeout = setTimeout(() => {
          const queries = lastQueries.map(q => getSqlQueryString(q));
          logger.error(`Pg client has been checked out for more than 5 seconds`);
          logger.error(`Last query: ${queries.join('|')}`);
        }, 5000);
        // @ts-expect-error
        client.query = (...args) => {
          lastQueries.push(args[0]);
          // @ts-expect-error
          return query.apply(client, args);
        };
        client.release = () => {
          clearTimeout(timeout);
          client.query = query;
          client.release = release;
          return release.apply(client);
        };
      }
      const result = await cb(client);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Execute queries within a sql transaction.
   */
  async queryTx<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    return await this.query(async client => {
      try {
        await client.query('BEGIN');
        const result = await cb(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async getChainTipHeight(
    client: ClientBase
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    const currentTipBlock = await client.query<{
      block_height: number;
      block_hash: Buffer;
      index_block_hash: Buffer;
    }>(
      `
      SELECT block_height, block_hash, index_block_hash
      FROM blocks
      WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
      `
    );
    const height = currentTipBlock.rows[0]?.block_height ?? 0;
    return {
      blockHeight: height,
      blockHash: bufferToHexPrefixString(currentTipBlock.rows[0]?.block_hash ?? Buffer.from([])),
      indexBlockHash: bufferToHexPrefixString(
        currentTipBlock.rows[0]?.index_block_hash ?? Buffer.from([])
      ),
    };
  }

  async update(data: DataStoreUpdateData): Promise<void> {
    await this.queryTx(async client => {
      const chainTip = await this.getChainTipHeight(client);
      await this.handleReorg(client, data.block, chainTip.blockHeight);
      // If the incoming block is not of greater height than current chain tip, then store data as non-canonical.
      const isCanonical = data.block.block_height > chainTip.blockHeight;
      if (!isCanonical) {
        data.block = { ...data.block, canonical: false };
        data.txs = data.txs.map(tx => ({
          tx: { ...tx.tx, canonical: false },
          stxLockEvents: tx.stxLockEvents.map(e => ({ ...e, canonical: false })),
          stxEvents: tx.stxEvents.map(e => ({ ...e, canonical: false })),
          ftEvents: tx.ftEvents.map(e => ({ ...e, canonical: false })),
          nftEvents: tx.nftEvents.map(e => ({ ...e, canonical: false })),
          contractLogEvents: tx.contractLogEvents.map(e => ({ ...e, canonical: false })),
          smartContracts: tx.smartContracts.map(e => ({ ...e, canonical: false })),
        }));
        data.minerRewards = data.minerRewards.map(mr => ({ ...mr, canonical: false }));
      } else {
        // When storing newly mined canonical txs, remove them from the mempool table.
        const candidateTxIds = data.txs.map(d => d.tx.tx_id);
        const removedTxsResult = await this.pruneMempoolTxs(client, candidateTxIds);
        if (removedTxsResult.removedTxs.length > 0) {
          logger.debug(`Removed ${removedTxsResult.removedTxs.length} txs from mempool table`);
        }
      }
      const blocksUpdated = await this.updateBlock(client, data.block);
      if (blocksUpdated !== 0) {
        for (const minerRewards of data.minerRewards) {
          await this.updateMinerReward(client, minerRewards);
        }
        for (const entry of data.txs) {
          await this.updateTx(client, entry.tx);
          await this.updateBatchStxEvents(client, entry.tx, entry.stxEvents);
          await this.updateBatchSmartContractEvent(client, entry.tx, entry.contractLogEvents);
          for (const stxLockEvent of entry.stxLockEvents) {
            await this.updateStxLockEvent(client, entry.tx, stxLockEvent);
          }
          for (const ftEvent of entry.ftEvents) {
            await this.updateFtEvent(client, entry.tx, ftEvent);
          }
          for (const nftEvent of entry.nftEvents) {
            await this.updateNftEvent(client, entry.tx, nftEvent);
          }
          for (const smartContract of entry.smartContracts) {
            await this.updateSmartContract(client, entry.tx, smartContract);
          }
        }
      }
    });
    this.emit('blockUpdate', data.block);
    data.txs.forEach(entry => {
      this.emit('txUpdate', entry.tx);
    });
    this.emitAddressTxUpdates(data);
  }

  emitAddressTxUpdates(data: DataStoreUpdateData) {
    // Record all addresses that had an associated tx.
    // Key = address, value = set of TxIds
    const addressTxUpdates = new Map<string, Set<DbTx>>();
    data.txs.forEach(entry => {
      const tx = entry.tx;
      const addAddressTx = (addr: string | undefined) => {
        if (addr) {
          getOrAdd(addressTxUpdates, addr, () => new Set()).add(tx);
        }
      };
      addAddressTx(tx.sender_address);
      entry.stxLockEvents.forEach(event => {
        addAddressTx(event.locked_address);
      });
      entry.stxEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.ftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.nftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.smartContracts.forEach(event => {
        addAddressTx(event.contract_id);
      });
      switch (tx.type_id) {
        case DbTxTypeId.ContractCall:
          addAddressTx(tx.contract_call_contract_id);
          break;
        case DbTxTypeId.SmartContract:
          addAddressTx(tx.smart_contract_contract_id);
          break;
        case DbTxTypeId.TokenTransfer:
          addAddressTx(tx.token_transfer_recipient_address);
          break;
      }
    });
    addressTxUpdates.forEach((txs, address) => {
      this.emit('addressUpdate', {
        address,
        txs: Array.from(txs),
      });
    });
  }

  /**
   * Restore transactions in the mempool table. This should be called when mined transactions are
   * marked from canonical to non-canonical.
   * @param txIds - List of transactions to update in the mempool
   */
  async restoreMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ restoredTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { restoredTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Restoring mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = false 
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    const restoredTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { restoredTxs: restoredTxs };
  }

  /**
   * Remove transactions in the mempool table. This should be called when transactions are
   * mined into a block.
   * @param txIds - List of transactions to update in the mempool
   */
  async pruneMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ removedTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { removedTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Pruning mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = true 
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    const removedTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { removedTxs: removedTxs };
  }

  async markEntitiesCanonical(
    client: ClientBase,
    indexBlockHash: Buffer,
    canonical: boolean,
    updatedEntities: UpdatedEntities
  ): Promise<{ txsMarkedCanonical: string[]; txsMarkedNonCanonical: string[] }> {
    const txResult = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE txs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      RETURNING tx_id
      `,
      [indexBlockHash, canonical]
    );
    const txIds = txResult.rows.map(row => bufferToHexPrefixString(row.tx_id));
    if (canonical) {
      updatedEntities.markedCanonical.txs += txResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.txs += txResult.rowCount;
    }
    for (const txId of txIds) {
      logger.verbose(`Marked tx as ${canonical ? 'canonical' : 'non-canonical'}: ${txId}`);
    }

    const minerRewardResults = await client.query(
      `
      UPDATE miner_rewards
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.minerRewards += minerRewardResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.minerRewards += minerRewardResults.rowCount;
    }

    const stxLockResults = await client.query(
      `
      UPDATE stx_lock_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxLockEvents += stxLockResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxLockEvents += stxLockResults.rowCount;
    }

    const stxResults = await client.query(
      `
      UPDATE stx_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxEvents += stxResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxEvents += stxResults.rowCount;
    }

    const ftResult = await client.query(
      `
      UPDATE ft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.ftEvents += ftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.ftEvents += ftResult.rowCount;
    }

    const nftResult = await client.query(
      `
      UPDATE nft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.nftEvents += nftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.nftEvents += nftResult.rowCount;
    }

    const contractLogResult = await client.query(
      `
      UPDATE contract_logs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.contractLogs += contractLogResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.contractLogs += contractLogResult.rowCount;
    }

    const smartContractResult = await client.query(
      `
      UPDATE smart_contracts
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.smartContracts += smartContractResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.smartContracts += smartContractResult.rowCount;
    }

    return {
      txsMarkedCanonical: canonical ? txIds : [],
      txsMarkedNonCanonical: canonical ? [] : txIds,
    };
  }

  async restoreOrphanedChain(
    client: ClientBase,
    indexBlockHash: Buffer,
    updatedEntities: UpdatedEntities
  ): Promise<UpdatedEntities> {
    const blockResult = await client.query<{
      parent_index_block_hash: Buffer;
      block_height: number;
    }>(
      `
      -- restore the previously orphaned block to canonical
      UPDATE blocks
      SET canonical = true
      WHERE index_block_hash = $1 AND canonical = false
      RETURNING parent_index_block_hash, block_hash, block_height
      `,
      [indexBlockHash]
    );

    if (blockResult.rowCount === 0) {
      throw new Error(
        `Could not find orphaned block by index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    if (blockResult.rowCount > 1) {
      throw new Error(
        `Found multiple non-canonical parents for index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    updatedEntities.markedCanonical.blocks++;

    const orphanedBlockResult = await client.query<{ index_block_hash: Buffer }>(
      `
      -- orphan the now conflicting block at the same height
      UPDATE blocks
      SET canonical = false
      WHERE block_height = $1 AND index_block_hash != $2 AND canonical = true
      RETURNING index_block_hash
      `,
      [blockResult.rows[0].block_height, indexBlockHash]
    );
    if (orphanedBlockResult.rowCount > 0) {
      updatedEntities.markedNonCanonical.blocks++;
      const markNonCanonicalResult = await this.markEntitiesCanonical(
        client,
        orphanedBlockResult.rows[0].index_block_hash,
        false,
        updatedEntities
      );
      await this.restoreMempoolTxs(client, markNonCanonicalResult.txsMarkedNonCanonical);
    }

    const markCanonicalResult = await this.markEntitiesCanonical(
      client,
      indexBlockHash,
      true,
      updatedEntities
    );
    await this.pruneMempoolTxs(client, markCanonicalResult.txsMarkedCanonical);

    const parentResult = await client.query<{ index_block_hash: Buffer }>(
      `
      -- check if the parent block is also orphaned
      SELECT index_block_hash
      FROM blocks
      WHERE
        block_height = $1 AND
        index_block_hash = $2 AND
        canonical = false
      `,
      [blockResult.rows[0].block_height - 1, blockResult.rows[0].parent_index_block_hash]
    );
    if (parentResult.rowCount > 1) {
      throw new Error('Found more than one non-canonical parent to restore during reorg');
    }
    if (parentResult.rowCount > 0) {
      await this.restoreOrphanedChain(
        client,
        parentResult.rows[0].index_block_hash,
        updatedEntities
      );
    }
    return updatedEntities;
  }

  async handleReorg(
    client: ClientBase,
    block: DbBlock,
    chainTipHeight: number
  ): Promise<UpdatedEntities> {
    const updatedEntities: UpdatedEntities = {
      markedCanonical: {
        blocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
      },
      markedNonCanonical: {
        blocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
      },
    };

    // Check if incoming block's parent is canonical
    if (block.block_height > 1) {
      const parentResult = await client.query<{
        canonical: boolean;
        index_block_hash: Buffer;
        parent_index_block_hash: Buffer;
      }>(
        `
        SELECT canonical, index_block_hash, parent_index_block_hash
        FROM blocks
        WHERE block_height = $1 AND index_block_hash = $2
        `,
        [block.block_height - 1, hexToBuffer(block.parent_index_block_hash)]
      );

      if (parentResult.rowCount > 1) {
        throw new Error(
          `DB contains multiple blocks at height ${block.block_height - 1} and index_hash ${
            block.parent_index_block_hash
          }`
        );
      }
      if (parentResult.rowCount === 0) {
        throw new Error(
          `DB does not contain a parent block at height ${block.block_height - 1} with index_hash ${
            block.parent_index_block_hash
          }`
        );
      }

      // This blocks builds off a previously orphaned chain. Restore canonical status for this chain.
      if (!parentResult.rows[0].canonical && block.block_height > chainTipHeight) {
        await this.restoreOrphanedChain(
          client,
          parentResult.rows[0].index_block_hash,
          updatedEntities
        );
        this.logReorgResultInfo(updatedEntities);
      }
    }
    return updatedEntities;
  }

  logReorgResultInfo(updatedEntities: UpdatedEntities) {
    const updates = [
      ['blocks', updatedEntities.markedCanonical.blocks, updatedEntities.markedNonCanonical.blocks],
      ['txs', updatedEntities.markedCanonical.txs, updatedEntities.markedNonCanonical.txs],
      [
        'miner-rewards',
        updatedEntities.markedCanonical.minerRewards,
        updatedEntities.markedNonCanonical.minerRewards,
      ],
      [
        'stx-lock events',
        updatedEntities.markedCanonical.stxLockEvents,
        updatedEntities.markedNonCanonical.stxLockEvents,
      ],
      [
        'stx-token events',
        updatedEntities.markedCanonical.stxEvents,
        updatedEntities.markedNonCanonical.stxEvents,
      ],
      [
        'non-fungible-token events',
        updatedEntities.markedCanonical.nftEvents,
        updatedEntities.markedNonCanonical.nftEvents,
      ],
      [
        'fungible-token events',
        updatedEntities.markedCanonical.ftEvents,
        updatedEntities.markedNonCanonical.ftEvents,
      ],
      [
        'contract logs',
        updatedEntities.markedCanonical.contractLogs,
        updatedEntities.markedNonCanonical.contractLogs,
      ],
      [
        'smart contracts',
        updatedEntities.markedCanonical.smartContracts,
        updatedEntities.markedNonCanonical.smartContracts,
      ],
    ];
    const markedCanonical = updates.map(e => `${e[1]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as canonical: ${markedCanonical}`);
    const markedNonCanonical = updates.map(e => `${e[2]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as non-canonical: ${markedNonCanonical}`);
  }

  static async connect(skipMigrations = false): Promise<PgDataStore> {
    const clientConfig = getPgClientConfig();

    const initTimer = stopwatch();
    let connectionError: Error | undefined;
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
          logError('Cannot connect to pg', error);
          throw error;
        }
        logError('Pg connection failed, retrying in 2000ms..');
        connectionError = error;
        await timeout(2000);
      } finally {
        client.end(() => {});
      }
    } while (initTimer.getElapsed() < Number.MAX_SAFE_INTEGER);
    if (!connectionOkay) {
      connectionError = connectionError ?? new Error('Error connecting to database');
      throw connectionError;
    }

    if (!skipMigrations) {
      await runMigrations(clientConfig);
    }
    const pool = new Pool({
      ...clientConfig,
    });
    let poolClient: PoolClient | undefined;
    try {
      poolClient = await pool.connect();
      return new PgDataStore(pool);
    } catch (error) {
      logError(
        `Error connecting to Postgres using ${JSON.stringify(clientConfig)}: ${error}`,
        error
      );
      throw error;
    } finally {
      poolClient?.release();
    }
  }

  async updateMinerReward(client: ClientBase, minerReward: DbMinerReward): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO miner_rewards(
        block_hash, index_block_hash, from_index_block_hash, mature_block_height, canonical, recipient, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        hexToBuffer(minerReward.block_hash),
        hexToBuffer(minerReward.index_block_hash),
        hexToBuffer(minerReward.from_index_block_hash),
        minerReward.mature_block_height,
        minerReward.canonical,
        minerReward.recipient,
        minerReward.coinbase_amount,
        minerReward.tx_fees_anchored,
        minerReward.tx_fees_streamed_confirmed,
        minerReward.tx_fees_streamed_produced,
      ]
    );
    return result.rowCount;
  }

  async updateBlock(client: ClientBase, block: DbBlock): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO blocks(
        block_hash, index_block_hash, parent_index_block_hash, parent_block_hash, parent_microblock, block_height, 
        burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (index_block_hash)
      DO NOTHING
      `,
      [
        hexToBuffer(block.block_hash),
        hexToBuffer(block.index_block_hash),
        hexToBuffer(block.parent_index_block_hash),
        hexToBuffer(block.parent_block_hash),
        hexToBuffer(block.parent_microblock),
        block.block_height,
        block.burn_block_time,
        hexToBuffer(block.burn_block_hash),
        block.burn_block_height,
        hexToBuffer(block.miner_txid),
        block.canonical,
      ]
    );
    return result.rowCount;
  }

  parseBlockQueryResult(row: BlockQueryResult): DbBlock {
    const block: DbBlock = {
      block_hash: bufferToHexPrefixString(row.block_hash),
      index_block_hash: bufferToHexPrefixString(row.index_block_hash),
      parent_index_block_hash: bufferToHexPrefixString(row.parent_index_block_hash),
      parent_block_hash: bufferToHexPrefixString(row.parent_block_hash),
      parent_microblock: bufferToHexPrefixString(row.parent_microblock),
      block_height: row.block_height,
      burn_block_time: row.burn_block_time,
      burn_block_hash: bufferToHexPrefixString(row.burn_block_hash),
      burn_block_height: row.burn_block_height,
      miner_txid: bufferToHexPrefixString(row.miner_txid),
      canonical: row.canonical,
    };
    return block;
  }

  async getBlock(blockHash: string) {
    return this.query(async client => {
      const result = await client.query<BlockQueryResult>(
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
    });
  }

  async getBlockByHeight(blockHeight: number) {
    return this.query(async client => {
      return this.getBlockByHeightInternal(client, blockHeight);
    });
  }

  async getBlockByHeightInternal(client: ClientBase, blockHeight: number) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE block_height = $1 AND canonical = true
      `,
      [blockHeight]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getCurrentBlock() {
    return this.query(async client => {
      return this.getCurrentBlockInternal(client);
    });
  }

  async getCurrentBlockInternal(client: ClientBase) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE canonical = true
      ORDER BY block_height DESC
      LIMIT 1
      `
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = this.parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlocks({ limit, offset }: { limit: number; offset: number }) {
    return this.queryTx(async client => {
      const total = await client.query<{ count: number }>(`
        SELECT COUNT(*)::integer
        FROM blocks
        WHERE canonical = true
      `);
      const results = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT $1
        OFFSET $2
        `,
        [limit, offset]
      );
      const parsed = results.rows.map(r => this.parseBlockQueryResult(r));
      return { results: parsed, total: total.rows[0].count } as const;
    });
  }

  async getBlockTxs(indexBlockHash: string) {
    return this.query(async client => {
      const result = await client.query<{ tx_id: Buffer; tx_index: number }>(
        `
        SELECT tx_id, tx_index
        FROM txs
        WHERE index_block_hash = $1
        `,
        [hexToBuffer(indexBlockHash)]
      );
      const txIds = result.rows
        .sort(tx => tx.tx_index)
        .map(tx => bufferToHexPrefixString(tx.tx_id));
      return { results: txIds };
    });
  }

  async getBlockTxsRows(blockHash: string) {
    return this.query(async client => {
      const result = await client.query<TxQueryResult>(
        `
        SELECT ${TX_COLUMNS}
        FROM txs
        WHERE block_hash = $1 AND canonical = true
        `,
        [hexToBuffer(blockHash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const parsed = result.rows.map(r => this.parseTxQueryResult(r));
      return { found: true, result: parsed };
    });
  }

  async updateBurnchainRewards({
    burnchainBlockHash,
    burnchainBlockHeight,
    rewards,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    return this.queryTx(async client => {
      const existingRewards = await client.query<{
        reward_recipient: string;
        reward_amount: string;
      }>(
        `
        UPDATE burnchain_rewards
        SET canonical = false
        WHERE canonical = true AND (burn_block_hash = $1 OR burn_block_height >= $2) 
        RETURNING reward_recipient, reward_amount
        `,
        [hexToBuffer(burnchainBlockHash), burnchainBlockHeight]
      );
      if (existingRewards.rowCount > 0) {
        logger.warn(
          `Invalidated ${existingRewards.rowCount} burnchain rewards after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }

      for (const reward of rewards) {
        const rewardInsertResult = await client.query(
          `
          INSERT into burnchain_rewards(
            canonical, burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
          ) values($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            true,
            hexToBuffer(reward.burn_block_hash),
            reward.burn_block_height,
            reward.burn_amount,
            reward.reward_recipient,
            reward.reward_amount,
            reward.reward_index,
          ]
        );
        if (rewardInsertResult.rowCount !== 1) {
          throw new Error(`Failed to insert burnchain reward at block ${reward.burn_block_hash}`);
        }
      }
    });
  }

  async getBurnchainRewards({
    burnchainRecipient,
    limit,
    offset,
  }: {
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]> {
    return this.query(async client => {
      const queryResults = await client.query<{
        burn_block_hash: Buffer;
        burn_block_height: number;
        burn_amount: string;
        reward_recipient: string;
        reward_amount: string;
        reward_index: number;
      }>(
        `
        SELECT burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
        FROM burnchain_rewards
        WHERE canonical = true ${burnchainRecipient ? 'AND reward_recipient = $3' : ''}
        ORDER BY burn_block_height DESC, reward_index DESC
        LIMIT $1
        OFFSET $2
        `,
        burnchainRecipient ? [limit, offset, burnchainRecipient] : [limit, offset]
      );
      return queryResults.rows.map(r => {
        const parsed: DbBurnchainReward = {
          canonical: true,
          burn_block_hash: bufferToHexPrefixString(r.burn_block_hash),
          burn_block_height: r.burn_block_height,
          burn_amount: BigInt(r.burn_amount),
          reward_recipient: r.reward_recipient,
          reward_amount: BigInt(r.reward_amount),
          reward_index: r.reward_index,
        };
        return parsed;
      });
    });
  }

  async getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }> {
    return this.query(async client => {
      const queryResults = await client.query<{
        amount: string;
      }>(
        `
        SELECT sum(reward_amount) amount
        FROM burnchain_rewards
        WHERE canonical = true AND reward_recipient = $1
        `,
        [burnchainRecipient]
      );
      const resultAmount = BigInt(queryResults.rows[0]?.amount ?? 0);
      return { reward_recipient: burnchainRecipient, reward_amount: resultAmount };
    });
  }

  async updateTx(client: ClientBase, tx: DbTx): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO txs(
        ${TX_COLUMNS}
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
      ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash
      DO NOTHING
      `,
      [
        hexToBuffer(tx.tx_id),
        tx.raw_tx,
        tx.tx_index,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.block_hash),
        tx.block_height,
        tx.burn_block_time,
        tx.type_id,
        tx.status,
        tx.canonical,
        tx.post_conditions,
        tx.nonce,
        tx.fee_rate,
        tx.sponsored,
        tx.sponsor_address,
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
        tx.raw_result ? hexToBuffer(tx.raw_result) : null,
      ]
    );
    return result.rowCount;
  }

  async updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTx[] }): Promise<void> {
    const updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      for (const tx of txs) {
        const result = await client.query(
          `
          INSERT INTO mempool_txs(
            ${MEMPOOL_TX_COLUMNS}
          ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
          ON CONFLICT ON CONSTRAINT unique_tx_id
          DO NOTHING
          `,
          [
            tx.pruned,
            hexToBuffer(tx.tx_id),
            tx.raw_tx,
            tx.type_id,
            tx.status,
            tx.receipt_time,
            tx.post_conditions,
            tx.nonce,
            tx.fee_rate,
            tx.sponsored,
            tx.sponsor_address,
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
        if (result.rowCount !== 1) {
          const errMsg = `A duplicate transaction was attempted to be inserted into the mempool_txs table: ${tx.tx_id}`;
          logger.error(errMsg);
        } else {
          updatedTxs.push(tx);
        }
      }
    });
    for (const tx of updatedTxs) {
      this.emit('txUpdate', tx);
    }
  }

  async dropMempoolTxs({ status, txIds }: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    let updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
      const updateResults = await client.query<MempoolTxQueryResult>(
        `
        UPDATE mempool_txs
        SET pruned = true, status = $2
        WHERE tx_id = ANY($1)
        RETURNING ${MEMPOOL_TX_COLUMNS}
        `,
        [txIdBuffers, status]
      );
      updatedTxs = updateResults.rows.map(r => this.parseMempoolTxQueryResult(r));
    });
    for (const tx of updatedTxs) {
      this.emit('txUpdate', tx);
    }
  }

  // TODO: re-use tx-type parsing code from `parseTxQueryResult`
  parseMempoolTxQueryResult(result: MempoolTxQueryResult): DbMempoolTx {
    const tx: DbMempoolTx = {
      pruned: result.pruned,
      tx_id: bufferToHexPrefixString(result.tx_id),
      nonce: result.nonce,
      raw_tx: result.raw_tx,
      type_id: result.type_id as DbTxTypeId,
      status: result.status,
      receipt_time: result.receipt_time,
      post_conditions: result.post_conditions,
      fee_rate: BigInt(result.fee_rate),
      sponsored: result.sponsored,
      sender_address: result.sender_address,
      origin_hash_mode: result.origin_hash_mode,
    };
    if (result.sponsor_address) {
      tx.sponsor_address = result.sponsor_address;
    }
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

  parseTxQueryResult(result: TxQueryResult): DbTx {
    const tx: DbTx = {
      tx_id: bufferToHexPrefixString(result.tx_id),
      tx_index: result.tx_index,
      nonce: result.nonce,
      raw_tx: result.raw_tx,
      index_block_hash: bufferToHexPrefixString(result.index_block_hash),
      block_hash: bufferToHexPrefixString(result.block_hash),
      block_height: result.block_height,
      burn_block_time: result.burn_block_time,
      type_id: result.type_id as DbTxTypeId,
      status: result.status,
      raw_result: result.raw_result ? bufferToHexPrefixString(result.raw_result) : '',
      canonical: result.canonical,
      post_conditions: result.post_conditions,
      fee_rate: BigInt(result.fee_rate),
      sponsored: result.sponsored,
      sender_address: result.sender_address,
      origin_hash_mode: result.origin_hash_mode,
    };
    if (result.sponsor_address) {
      tx.sponsor_address = result.sponsor_address;
    }
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

  parseFaucetRequestQueryResult(result: FaucetRequestQueryResult): DbFaucetRequest {
    const tx: DbFaucetRequest = {
      currency: result.currency as DbFaucetRequestCurrency,
      address: result.address,
      ip: result.ip,
      occurred_at: parseInt(result.occurred_at),
    };
    return tx;
  }

  async getMempoolTx({ txId, includePruned }: { txId: string; includePruned?: boolean }) {
    return this.query(async client => {
      const prunedCondition = includePruned ? '' : 'AND pruned = false';
      const result = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}
        FROM mempool_txs
        WHERE tx_id = $1 ${prunedCondition}
        `,
        [hexToBuffer(txId)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      if (result.rowCount > 1) {
        throw new Error(`Multiple transactions found in mempool table for txid: ${txId}`);
      }
      const row = result.rows[0];
      const tx = this.parseMempoolTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getDroppedTxs({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    return await this.queryTx(async client => {
      const droppedStatuses = [
        DbTxStatus.DroppedReplaceByFee,
        DbTxStatus.DroppedReplaceAcrossFork,
        DbTxStatus.DroppedTooExpensive,
        DbTxStatus.DroppedStaleGarbageCollect,
      ];
      const selectCols = MEMPOOL_TX_COLUMNS.replace('tx_id', 'mempool.tx_id');
      const resultQuery = await client.query<MempoolTxQueryResult & { count: string }>(
        `
        SELECT ${selectCols}, COUNT(*) OVER() AS count
        FROM (
          SELECT *
          FROM mempool_txs
          WHERE pruned = true AND status = ANY($1)
        ) mempool
        LEFT JOIN (
          SELECT tx_id
          FROM txs
          WHERE canonical = true
        ) mined
        ON mempool.tx_id = mined.tx_id
        WHERE mined.tx_id IS NULL
        ORDER BY receipt_time DESC
        LIMIT $2
        OFFSET $3
        `,
        [droppedStatuses, limit, offset]
      );
      const count = resultQuery.rows.length > 0 ? parseInt(resultQuery.rows[0].count) : 0;
      const mempoolTxs = resultQuery.rows.map(r => this.parseMempoolTxQueryResult(r));
      return { results: mempoolTxs, total: count };
    });
  }

  async getMempoolTxList({
    limit,
    offset,
    senderAddress,
    recipientAddress,
    address,
  }: {
    limit: number;
    offset: number;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    let whereCondition: string | undefined;
    let queryValues: any[];

    if (address) {
      whereCondition = 'sender_address = $1 OR token_transfer_recipient_address = $1';
      queryValues = [address];
    } else if (senderAddress && recipientAddress) {
      whereCondition = 'sender_address = $1 AND token_transfer_recipient_address = $2';
      queryValues = [senderAddress, recipientAddress];
    } else if (senderAddress) {
      whereCondition = 'sender_address = $1';
      queryValues = [senderAddress];
    } else if (recipientAddress) {
      whereCondition = 'token_transfer_recipient_address = $1';
      queryValues = [recipientAddress];
    } else {
      whereCondition = undefined;
      queryValues = [];
    }

    const queryResult = await this.queryTx(async client => {
      const totalQuery = await client.query<{ count: number }>(
        `
        SELECT COUNT(*)::integer
        FROM mempool_txs
        WHERE pruned = false ${whereCondition ? `AND ${whereCondition}` : ''}
        `,
        [...queryValues]
      );
      const resultQuery = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}
        FROM mempool_txs
        WHERE pruned = false ${whereCondition ? `AND ${whereCondition}` : ''}
        ORDER BY receipt_time DESC
        LIMIT $${queryValues.length + 1}
        OFFSET $${queryValues.length + 2}
        `,
        [...queryValues, limit, offset]
      );
      return { total: totalQuery.rows[0].count, rows: resultQuery.rows };
    });

    const parsed = queryResult.rows.map(r => this.parseMempoolTxQueryResult(r));
    return { results: parsed, total: queryResult.total };
  }

  async getMempoolTxIdList(): Promise<{ results: DbMempoolTxId[] }> {
    return this.query(async client => {
      const resultQuery = await client.query<MempoolTxIdQueryResult>(
        `
        SELECT ${MEMPOOL_TX_ID_COLUMNS}
        FROM mempool_txs
        ORDER BY receipt_time DESC
        `
      );
      const parsed = resultQuery.rows.map(r => {
        const tx: DbMempoolTxId = {
          tx_id: bufferToHexPrefixString(r.tx_id),
        };
        return tx;
      });
      return { results: parsed };
    });
  }

  async getTx(txId: string) {
    return this.query(async client => {
      const result = await client.query<TxQueryResult>(
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
    });
  }

  async getTxList({
    limit,
    offset,
    txTypeFilter,
  }: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
  }) {
    let totalQuery: QueryResult<{ count: number }>;
    let resultQuery: QueryResult<TxQueryResult>;
    return this.queryTx(async client => {
      if (txTypeFilter.length === 0) {
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true
          `
        );
        resultQuery = await client.query<TxQueryResult>(
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
      } else {
        const txTypeIds = txTypeFilter.map<number>(t => getTxTypeId(t));
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true AND type_id = ANY($1)
          `,
          [txTypeIds]
        );
        resultQuery = await client.query<TxQueryResult>(
          `
          SELECT ${TX_COLUMNS}
          FROM txs
          WHERE canonical = true AND type_id = ANY($1)
          ORDER BY block_height DESC, tx_index DESC
          LIMIT $2
          OFFSET $3
          `,
          [txTypeIds, limit, offset]
        );
      }
      const parsed = resultQuery.rows.map(r => this.parseTxQueryResult(r));
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  async getTxEvents(args: { txId: string; indexBlockHash: string; limit: number; offset: number }) {
    return this.queryTx(async client => {
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      const txIdBuffer = hexToBuffer(args.txId);
      const blockHashBuffer = hexToBuffer(args.indexBlockHash);
      const stxLockResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
        FROM stx_lock_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
        FROM stx_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
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
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
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
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE tx_id = $1 AND index_block_hash = $2 AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const events = new Array<DbEvent>(
        stxResults.rowCount +
          nftResults.rowCount +
          ftResults.rowCount +
          logResults.rowCount +
          stxLockResults.rowCount
      );
      let rowIndex = 0;
      for (const result of stxLockResults.rows) {
        const event: DbStxLockEvent = {
          event_type: DbEventTypeId.StxLock,
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          tx_index: result.tx_index,
          block_height: result.block_height,
          canonical: result.canonical,
          locked_amount: BigInt(result.locked_amount),
          unlock_height: Number(result.unlock_height),
          locked_address: result.locked_address,
        };
        events[rowIndex++] = event;
      }
      for (const result of stxResults.rows) {
        const event: DbStxEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          tx_index: result.tx_index,
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
          tx_index: result.tx_index,
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
          tx_index: result.tx_index,
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
          tx_index: result.tx_index,
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
    });
  }

  async updateStxLockEvent(client: ClientBase, tx: DbTx, event: DbStxLockEvent) {
    await client.query(
      `
      INSERT INTO stx_lock_events(
        event_index, tx_id, tx_index, block_height, index_block_hash, canonical, locked_amount, unlock_height, locked_address
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.locked_amount,
        event.unlock_height,
        event.locked_address,
      ]
    );
  }

  async updateBatchStxEvents(client: ClientBase, tx: DbTx, events: DbStxEvent[]) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 10;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          event.canonical,
          event.asset_event_type_id,
          event.sender,
          event.recipient,
          event.amount
        );
      }
      const insertQuery = `INSERT INTO stx_events(
        event_index, tx_id, tx_index, block_height, index_block_hash, 
        canonical, asset_event_type_id, sender, recipient, amount
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-stx-events_${columnCount}x${eventBatch.length}`;
      const insertStxEventQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQuery,
        values,
      };
      const res = await client.query(insertStxEventQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  cachedParameterizedInsertStrings = new Map<string, string>();

  generateParameterizedInsertString({
    columnCount,
    rowCount,
  }: {
    columnCount: number;
    rowCount: number;
  }): string {
    const cacheKey = `${columnCount}x${rowCount}`;
    const existing = this.cachedParameterizedInsertStrings.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }
    const params: string[][] = [];
    let i = 1;
    for (let r = 0; r < rowCount; r++) {
      params[r] = Array<string>(columnCount);
      for (let c = 0; c < columnCount; c++) {
        params[r][c] = `\$${i++}`;
      }
    }
    const stringRes = params.map(r => `(${r.join(',')})`).join(',');
    this.cachedParameterizedInsertStrings.set(cacheKey, stringRes);
    return stringRes;
  }

  async updateStxEvent(client: ClientBase, tx: DbTx, event: DbStxEvent) {
    const insertStxEventQuery: QueryConfig = {
      name: 'insert-stx-event',
      text: `
        INSERT INTO stx_events(
          event_index, tx_id, tx_index, block_height, index_block_hash, 
          canonical, asset_event_type_id, sender, recipient, amount
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      values: [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.amount,
      ],
    };
    await client.query(insertStxEventQuery);
  }

  async updateFtEvent(client: ClientBase, tx: DbTx, event: DbFtEvent) {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, tx_index, block_height, index_block_hash, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
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
        event_index, tx_id, tx_index, block_height, index_block_hash, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
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

  async updateBatchSmartContractEvent(
    client: ClientBase,
    tx: DbTx,
    events: DbSmartContractEvent[]
  ) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 9;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          event.canonical,
          event.contract_identifier,
          event.topic,
          event.value
        );
      }
      const insertQueryText = `INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash, canonical, contract_identifier, topic, value
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-smart-contract-events_${columnCount}x${eventBatch.length}`;
      const insertQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQueryText,
        values,
      };
      const res = await client.query(insertQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  async updateSmartContractEvent(client: ClientBase, tx: DbTx, event: DbSmartContractEvent) {
    await client.query(
      `
      INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash, canonical, contract_identifier, topic, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
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
    return this.query(async client => {
      const result = await client.query<{
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
    });
  }

  async getSmartContractEvents({
    contractId,
    limit,
    offset,
  }: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>> {
    return this.query(async client => {
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, contract_identifier, topic, value
        FROM contract_logs
        WHERE canonical = true AND contract_identifier = $1
        ORDER BY block_height DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [contractId, limit, offset]
      );
      const result = logResults.rows.map(result => {
        const event: DbSmartContractEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
          tx_index: result.tx_index,
          block_height: result.block_height,
          canonical: true,
          event_type: DbEventTypeId.SmartContractLog,
          contract_identifier: result.contract_identifier,
          topic: result.topic,
          value: result.value,
        };
        return event;
      });
      return { found: true, result };
    });
  }

  async getStxBalance(stxAddress: string): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const blockQuery = await this.getCurrentBlockInternal(client);
      if (!blockQuery.found) {
        throw new Error(`Could not find current block`);
      }
      const result = await this.internalGetStxBalanceAtBlock(client, stxAddress, blockQuery.result);
      return result;
    });
  }

  async getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const blockQuery = await this.getBlockByHeightInternal(client, blockHeight);
      if (!blockQuery.found) {
        throw new Error(`Could not find block at height: ${blockHeight}`);
      }
      const result = await this.internalGetStxBalanceAtBlock(client, stxAddress, blockQuery.result);
      return result;
    });
  }

  async internalGetStxBalanceAtBlock(
    client: ClientBase,
    stxAddress: string,
    block: DbBlock
  ): Promise<DbStxBalance> {
    const blockHeight = block.block_height;
    const burnchainBlockHeight = block.burn_block_height;
    const result = await client.query<{
      credit_total: string | null;
      debit_total: string | null;
    }>(
      `
      WITH transfers AS (
        SELECT amount, sender, recipient
        FROM stx_events
        WHERE canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $2
      ), credit AS (
        SELECT sum(amount) as credit_total
        FROM transfers
        WHERE recipient = $1
      ), debit AS (
        SELECT sum(amount) as debit_total
        FROM transfers
        WHERE sender = $1
      )
      SELECT credit_total, debit_total
      FROM credit CROSS JOIN debit
      `,
      [stxAddress, blockHeight]
    );
    const feeQuery = await client.query<{ fee_sum: string }>(
      `
      SELECT sum(fee_rate) as fee_sum
      FROM txs
      WHERE canonical = true AND sender_address = $1 AND block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const lockQuery = await client.query<{
      locked_amount: string;
      unlock_height: string;
      block_height: string;
      tx_id: Buffer;
    }>(
      `
      SELECT locked_amount, unlock_height, block_height, tx_id
      FROM stx_lock_events
      WHERE canonical = true AND locked_address = $1
      AND block_height <= $2 AND unlock_height > $3
      `,
      [stxAddress, blockHeight, burnchainBlockHeight]
    );
    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;
    if (lockQuery.rowCount > 1) {
      throw new Error(
        `stx_lock_events event query for ${stxAddress} should return zero or one rows but returned ${lockQuery.rowCount}`
      );
    } else if (lockQuery.rowCount === 1) {
      lockTxId = bufferToHexPrefixString(lockQuery.rows[0].tx_id);
      locked = BigInt(lockQuery.rows[0].locked_amount);
      burnchainUnlockHeight = parseInt(lockQuery.rows[0].unlock_height);
      lockHeight = parseInt(lockQuery.rows[0].block_height);
      const blockQuery = await this.getBlockByHeightInternal(client, lockHeight);
      burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
    }
    const minerRewardQuery = await client.query<{ amount: string }>(
      `
      SELECT sum(
        coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
      ) amount
      FROM miner_rewards
      WHERE canonical = true AND recipient = $1 AND mature_block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const totalRewards = BigInt(minerRewardQuery.rows[0]?.amount ?? 0);
    const totalFees = BigInt(feeQuery.rows[0]?.fee_sum ?? 0);
    const totalSent = BigInt(result.rows[0]?.debit_total ?? 0);
    const totalReceived = BigInt(result.rows[0]?.credit_total ?? 0);
    const balance = totalReceived - totalSent - totalFees + totalRewards;
    return {
      balance,
      totalSent,
      totalReceived,
      totalFeesSent: totalFees,
      totalMinerRewardsReceived: totalRewards,
      lockTxId: lockTxId,
      locked,
      lockHeight,
      burnchainLockHeight,
      burnchainUnlockHeight,
    };
  }

  async getUnlockedStxSupply({ blockHeight }: { blockHeight?: number }) {
    return this.queryTx(async client => {
      let atBlockHeight: number;
      if (blockHeight !== undefined) {
        atBlockHeight = blockHeight;
      } else {
        const blockQuery = await this.getCurrentBlockInternal(client);
        if (!blockQuery.found) {
          throw new Error(`Could not find current block`);
        }
        atBlockHeight = blockQuery.result.block_height;
      }
      const result = await client.query<{ amount: string }>(
        `
        SELECT SUM(amount) amount FROM (
          SELECT SUM(amount) amount
          FROM stx_events
          WHERE canonical = true
          AND asset_event_type_id = 2 -- mint events
          AND block_height <= $1
          UNION ALL
          SELECT SUM(coinbase_amount) amount
          FROM miner_rewards
          WHERE canonical = true
          AND mature_block_height <= $1
        ) totals
        `,
        [atBlockHeight]
      );
      if (result.rows.length < 1) {
        throw new Error(`No rows returned from total supply query`);
      }
      return { stx: BigInt(result.rows[0].amount), blockHeight: atBlockHeight };
    });
  }

  async getAddressAssetEvents({
    stxAddress,
    limit,
    offset,
  }: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }> {
    return this.query(async client => {
      const results = await client.query<{
        asset_type: 'stx_lock' | 'stx' | 'ft' | 'nft';
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount?: string;
        unlock_height?: string;
        value?: Buffer;
      }>(
        `
        SELECT * FROM (
          SELECT
            'stx_lock' as asset_type, event_index, tx_id, tx_index, block_height, canonical, 0 as asset_event_type_id, 
            locked_address as sender, '' as recipient, '<stx>' as asset_identifier, locked_amount as amount, unlock_height, null::bytea as value
          FROM stx_lock_events
          WHERE canonical = true AND locked_address = $1
          UNION ALL
          SELECT
            'stx' as asset_type, event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, 
            sender, recipient, '<stx>' as asset_identifier, amount::numeric, null::numeric as unlock_height, null::bytea as value
          FROM stx_events
          WHERE canonical = true AND (sender = $1 OR recipient = $1)
          UNION ALL
          SELECT
            'ft' as asset_type, event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, 
            sender, recipient, asset_identifier, amount, null::numeric as unlock_height, null::bytea as value
          FROM ft_events
          WHERE canonical = true AND (sender = $1 OR recipient = $1)
          UNION ALL
          SELECT
            'nft' as asset_type, event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, 
            sender, recipient, asset_identifier, null::numeric as amount, null::numeric as unlock_height, value
          FROM nft_events
          WHERE canonical = true AND (sender = $1 OR recipient = $1)
        ) asset_events
        ORDER BY block_height DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [stxAddress, limit, offset]
      );

      const events: DbEvent[] = results.rows.map(row => {
        if (row.asset_type === 'stx_lock') {
          const event: DbStxLockEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            locked_address: assertNotNullish(row.sender),
            locked_amount: BigInt(assertNotNullish(row.amount)),
            unlock_height: Number(assertNotNullish(row.unlock_height)),
            event_type: DbEventTypeId.StxLock,
          };
          return event;
        } else if (row.asset_type === 'stx') {
          const event: DbStxEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_type: DbEventTypeId.StxAsset,
            amount: BigInt(row.amount),
          };
          return event;
        } else if (row.asset_type === 'ft') {
          const event: DbFtEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            asset_identifier: row.asset_identifier,
            event_type: DbEventTypeId.FungibleTokenAsset,
            amount: BigInt(row.amount),
          };
          return event;
        } else if (row.asset_type === 'nft') {
          const event: DbNftEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            asset_identifier: row.asset_identifier,
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value as Buffer,
          };
          return event;
        } else {
          throw new Error(`Unexpected asset_type "${row.asset_type}"`);
        }
      });
      return {
        results: events,
        total: 0,
      };
    });
  }

  async getFungibleTokenBalances(stxAddress: string): Promise<Map<string, DbFtBalance>> {
    return this.query(async client => {
      const result = await client.query<{
        asset_identifier: string;
        credit_total: string | null;
        debit_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT amount, sender, recipient, asset_identifier
          FROM ft_events
          WHERE canonical = true AND (sender = $1 OR recipient = $1)
        ), credit AS (
          SELECT asset_identifier, sum(amount) as credit_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, sum(amount) as debit_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, credit_total, debit_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [stxAddress]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map<string, DbFtBalance>(
        rows.map(r => {
          const totalSent = BigInt(r.debit_total ?? 0);
          const totalReceived = BigInt(r.credit_total ?? 0);
          const balance = totalReceived - totalSent;
          return [r.asset_identifier, { balance, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getNonFungibleTokenCounts(
    stxAddress: string
  ): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    return this.query(async client => {
      const result = await client.query<{
        asset_identifier: string;
        received_total: string | null;
        sent_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT sender, recipient, asset_identifier
          FROM nft_events
          WHERE canonical = true AND (sender = $1 OR recipient = $1)
        ), credit AS (
          SELECT asset_identifier, COUNT(*) as received_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, COUNT(*) as sent_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, received_total, sent_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [stxAddress]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map(
        rows.map(r => {
          const totalSent = BigInt(r.sent_total ?? 0);
          const totalReceived = BigInt(r.received_total ?? 0);
          const count = totalReceived - totalSent;
          return [r.asset_identifier, { count, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getAddressTxs({
    stxAddress,
    limit,
    offset,
    height,
  }: {
    stxAddress: string;
    limit: number;
    offset: number;
    height?: number;
  }): Promise<{ results: DbTx[]; total: number }> {
    return this.query(async client => {
      const queryParams: any[] = [stxAddress, limit, offset];
      if (height !== undefined) {
        queryParams.push(height);
      }
      const resultQuery = await client.query<TxQueryResult & { count: number }>(
        `
        WITH transactions AS (
          SELECT *
          FROM txs
          WHERE canonical = true AND (
            sender_address = $1 OR 
            token_transfer_recipient_address = $1 OR 
            contract_call_contract_id = $1 OR 
            smart_contract_contract_id = $1
          )
          UNION
          SELECT txs.* FROM txs
          LEFT OUTER JOIN stx_events
          ON txs.tx_id = stx_events.tx_id
          WHERE txs.canonical = true AND (stx_events.sender = $1 OR stx_events.recipient = $1)
        )
        SELECT ${TX_COLUMNS}, (COUNT(*) OVER())::integer as count
        FROM transactions
        ${height !== undefined ? 'WHERE block_height = $4' : ''}
        ORDER BY block_height DESC, tx_index DESC
        LIMIT $2
        OFFSET $3
        `,
        queryParams
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed = resultQuery.rows.map(r => this.parseTxQueryResult(r));
      return { results: parsed, total: count };
    });
  }

  async getInboundTransfers({
    stxAddress,
    limit,
    offset,
    sendManyContractId,
    height,
  }: {
    stxAddress: string;
    limit: number;
    offset: number;
    sendManyContractId: string;
    height?: number;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    return this.query(async client => {
      const queryParams: any[] = [stxAddress, sendManyContractId, limit, offset];
      let whereClause = '';
      if (height !== undefined) {
        queryParams.push(height);
        whereClause = 'WHERE block_height = $5';
      }
      const resultQuery = await client.query<TransferQueryResult & { count: number }>(
        `
        SELECT
            *,
          (
            COUNT(*) OVER()
          )::INTEGER AS COUNT
        FROM
          (
            SELECT
              stx_events.amount AS amount,
              contract_logs.value AS memo,
              stx_events.sender AS sender,
              stx_events.block_height AS block_height,
              stx_events.tx_id,
              stx_events.tx_index,
              'bulk-send' as transfer_type
            FROM
              contract_logs,
              stx_events
            WHERE
              contract_logs.contract_identifier = $2
              AND contract_logs.tx_id = stx_events.tx_id
              AND stx_events.recipient = $1
              AND contract_logs.event_index = (stx_events.event_index + 1)
              AND stx_events.canonical = true
            UNION ALL
            SELECT
              token_transfer_amount AS amount,
              token_transfer_memo AS memo,
              sender_address AS sender,
              block_height,
              tx_id,
              tx_index,
              'stx-transfer' as transfer_type
            FROM
              txs
            WHERE
              canonical = TRUE
              AND type_id = 0
              AND token_transfer_recipient_address = $1
          ) transfers
        ${whereClause}
        ORDER BY
          block_height DESC,
          tx_index DESC
        LIMIT $3
        OFFSET $4
        `,
        queryParams
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed: DbInboundStxTransfer[] = resultQuery.rows.map(r => {
        return {
          sender: r.sender,
          memo: bufferToHexPrefixString(r.memo),
          amount: BigInt(r.amount),
          tx_id: bufferToHexPrefixString(r.tx_id),
          tx_index: r.tx_index,
          block_height: r.block_height,
          transfer_type: r.transfer_type,
        };
      });
      return {
        results: parsed,
        total: count,
      };
    });
  }

  async searchHash({ hash }: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    return this.query(async client => {
      const txQuery = await client.query<TxQueryResult>(
        `SELECT ${TX_COLUMNS} FROM txs WHERE tx_id = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (txQuery.rowCount > 0) {
        const txResult = this.parseTxQueryResult(txQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'tx_id',
            entity_id: bufferToHexPrefixString(txQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const txMempoolQuery = await client.query<MempoolTxQueryResult>(
        `SELECT ${MEMPOOL_TX_COLUMNS} FROM mempool_txs WHERE pruned = false AND tx_id = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (txMempoolQuery.rowCount > 0) {
        const txResult = this.parseMempoolTxQueryResult(txMempoolQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'mempool_tx_id',
            entity_id: bufferToHexPrefixString(txMempoolQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const blockQueryResult = await client.query<BlockQueryResult>(
        `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE block_hash = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (blockQueryResult.rowCount > 0) {
        const blockResult = this.parseBlockQueryResult(blockQueryResult.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'block_hash',
            entity_id: bufferToHexPrefixString(blockQueryResult.rows[0].block_hash),
            entity_data: blockResult,
          },
        };
      }
      return { found: false };
    });
  }

  async searchPrincipal({ principal }: { principal: string }): Promise<FoundOrNot<DbSearchResult>> {
    const isContract = principal.includes('.');
    const entityType = isContract ? 'contract_address' : 'standard_address';
    const successResponse = {
      found: true,
      result: {
        entity_type: entityType,
        entity_id: principal,
      },
    } as const;
    return await this.query(async client => {
      if (isContract) {
        const contractMempoolTxResult = await client.query<MempoolTxQueryResult>(
          `SELECT ${MEMPOOL_TX_COLUMNS} from mempool_txs WHERE pruned = false AND smart_contract_contract_id = $1 LIMIT 1`,
          [principal]
        );
        if (contractMempoolTxResult.rowCount > 0) {
          const txResult = this.parseMempoolTxQueryResult(contractMempoolTxResult.rows[0]);
          return {
            found: true,
            result: {
              entity_type: 'contract_address',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        const contractTxResult = await client.query<TxQueryResult>(
          `
          SELECT ${TX_COLUMNS}
          FROM txs
          WHERE smart_contract_contract_id = $1
          ORDER BY canonical DESC, block_height DESC
          LIMIT 1
          `,
          [principal]
        );
        if (contractTxResult.rowCount > 0) {
          const txResult = this.parseTxQueryResult(contractTxResult.rows[0]);
          return {
            found: true,
            result: {
              entity_type: 'tx_id',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        return { found: false } as const;
      }

      const addressQueryResult = await client.query(
        `
        SELECT sender_address, token_transfer_recipient_address
        FROM txs
        WHERE sender_address = $1 OR token_transfer_recipient_address = $1
        LIMIT 1
        `,
        [principal]
      );
      if (addressQueryResult.rowCount > 0) {
        return successResponse;
      }

      const stxQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM stx_events 
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (stxQueryResult.rowCount > 0) {
        return successResponse;
      }

      const ftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM ft_events 
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (ftQueryResult.rowCount > 0) {
        return successResponse;
      }

      const nftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM nft_events 
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (nftQueryResult.rowCount > 0) {
        return successResponse;
      }

      return { found: false };
    });
  }

  async insertFaucetRequest(faucetRequest: DbFaucetRequest) {
    await this.query(async client => {
      try {
        await client.query(
          `
          INSERT INTO faucet_requests(
            currency, address, ip, occurred_at
          ) values($1, $2, $3, $4)
          `,
          [
            faucetRequest.currency,
            faucetRequest.address,
            faucetRequest.ip,
            faucetRequest.occurred_at,
          ]
        );
      } catch (error) {
        logError(`Error performing faucet request update: ${error}`, error);
        throw error;
      }
    });
  }

  async getBTCFaucetRequests(address: string) {
    return this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'btc'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => this.parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async getSTXFaucetRequests(address: string) {
    return await this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'stx'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => this.parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
