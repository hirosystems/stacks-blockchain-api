import { BasePgStoreModule, PgSqlClient } from '@hirosystems/api-toolkit';
import {
  BlockLimitParamSchema,
  CompiledBurnBlockHashParam,
  TransactionPaginationQueryParams,
  TransactionLimitParamSchema,
  BlockParams,
  BlockPaginationQueryParams,
  SmartContractStatusParams,
  AddressParams,
  AddressTransactionParams,
  PoxCyclePaginationQueryParams,
  PoxCycleLimitParamSchema,
  PoxCycleParams,
  PoxSignerPaginationQueryParams,
  PoxSignerLimitParamSchema,
  PoxCycleSignerParams,
} from '../api/routes/v2/schemas';
import { InvalidRequestError, InvalidRequestErrorType } from '../errors';
import { normalizeHashString } from '../helpers';
import {
  DbPaginatedResult,
  DbBlock,
  BlockQueryResult,
  DbTx,
  TxQueryResult,
  DbBurnBlock,
  DbTxTypeId,
  DbSmartContractStatus,
  AddressTransfersTxQueryResult,
  DbTxWithAddressTransfers,
  DbEventTypeId,
  DbAddressTransactionEvent,
  DbAssetEventTypeId,
  DbPoxCycle,
  PoxCycleQueryResult,
  DbPoxCycleSigner,
  DbPoxCycleSignerStacker,
} from './common';
import {
  BLOCK_COLUMNS,
  parseBlockQueryResult,
  TX_COLUMNS,
  parseTxQueryResult,
  parseAccountTransferSummaryTxQueryResult,
} from './helpers';

async function assertAddressExists(sql: PgSqlClient, address: string) {
  const addressCheck =
    await sql`SELECT principal FROM principal_stx_txs WHERE principal = ${address} LIMIT 1`;
  if (addressCheck.count === 0)
    throw new InvalidRequestError(`Address not found`, InvalidRequestErrorType.invalid_param);
}

async function assertTxIdExists(sql: PgSqlClient, tx_id: string) {
  const txCheck = await sql`SELECT tx_id FROM txs WHERE tx_id = ${tx_id} LIMIT 1`;
  if (txCheck.count === 0)
    throw new InvalidRequestError(`Transaction not found`, InvalidRequestErrorType.invalid_param);
}

export class PgStoreV2 extends BasePgStoreModule {
  async getBlocks(args: BlockPaginationQueryParams): Promise<DbPaginatedResult<DbBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const blocksQuery = await sql<(BlockQueryResult & { total: number })[]>`
        WITH block_count AS (
          SELECT block_count AS count FROM chain_tip
        )
        SELECT
          ${sql(BLOCK_COLUMNS)},
          (SELECT count FROM block_count)::int AS total
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      if (blocksQuery.count === 0)
        return {
          limit,
          offset,
          results: [],
          total: 0,
        };
      const blocks = blocksQuery.map(b => parseBlockQueryResult(b));
      return {
        limit,
        offset,
        results: blocks,
        total: blocksQuery[0].total,
      };
    });
  }

  async getBlocksByBurnBlock(
    args: BlockParams & BlockPaginationQueryParams
  ): Promise<DbPaginatedResult<DbBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const filter =
        args.height_or_hash === 'latest'
          ? sql`burn_block_hash = (SELECT burn_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : CompiledBurnBlockHashParam(args.height_or_hash)
          ? sql`burn_block_hash = ${normalizeHashString(args.height_or_hash)}`
          : sql`burn_block_height = ${args.height_or_hash}`;
      const blockCheck = await sql`SELECT burn_block_hash FROM blocks WHERE ${filter} LIMIT 1`;
      if (blockCheck.count === 0)
        throw new InvalidRequestError(
          `Burn block not found`,
          InvalidRequestErrorType.invalid_param
        );

      const blocksQuery = await sql<(BlockQueryResult & { total: number })[]>`
        WITH block_count AS (
          SELECT COUNT(*) AS count FROM blocks WHERE canonical = TRUE AND ${filter}
        )
        SELECT
          ${sql(BLOCK_COLUMNS)},
          (SELECT count FROM block_count)::int AS total
        FROM blocks
        WHERE canonical = true AND ${filter}
        ORDER BY block_height DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      if (blocksQuery.count === 0)
        return {
          limit,
          offset,
          results: [],
          total: 0,
        };
      const blocks = blocksQuery.map(b => parseBlockQueryResult(b));
      return {
        limit,
        offset,
        results: blocks,
        total: blocksQuery[0].total,
      };
    });
  }

  async getBlock(args: BlockParams): Promise<DbBlock | undefined> {
    return await this.sqlTransaction(async sql => {
      const filter =
        args.height_or_hash === 'latest'
          ? sql`index_block_hash = (SELECT index_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : CompiledBurnBlockHashParam(args.height_or_hash)
          ? sql`(
              block_hash = ${normalizeHashString(args.height_or_hash)}
              OR index_block_hash = ${normalizeHashString(args.height_or_hash)}
            )`
          : sql`block_height = ${args.height_or_hash}`;
      const blockQuery = await sql<BlockQueryResult[]>`
        SELECT ${sql(BLOCK_COLUMNS)}
        FROM blocks
        WHERE canonical = true AND ${filter}
        LIMIT 1
      `;
      if (blockQuery.count > 0) return parseBlockQueryResult(blockQuery[0]);
    });
  }

  async getAverageBlockTimes(): Promise<{
    last_1h: number;
    last_24h: number;
    last_7d: number;
    last_30d: number;
  }> {
    return await this.sqlTransaction(async sql => {
      // Query against block_time but fallback to burn_block_time if block_time is 0 (work around for recent bug).
      // TODO: remove the burn_block_time fallback once all blocks for last N time have block_time set.
      const avgBlockTimeQuery = await sql<
        {
          last_1h: string | null;
          last_24h: string | null;
          last_7d: string | null;
          last_30d: string | null;
        }[]
      >`
        WITH TimeThresholds AS (
          SELECT
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '1 HOUR'))::INT AS h1,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '24 HOURS'))::INT AS h24,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '7 DAYS'))::INT AS d7,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '30 DAYS'))::INT AS d30
        ),
        OrderedCanonicalBlocks AS (
          SELECT
            CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END AS effective_time,
            LAG(CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END) OVER (ORDER BY block_height) AS prev_time
          FROM
            blocks
          WHERE
            canonical = true AND
            (CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END) >= (SELECT d30 FROM TimeThresholds)
        )
        SELECT
          AVG(CASE WHEN effective_time >= (SELECT h1 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_1h,
          AVG(CASE WHEN effective_time >= (SELECT h24 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_24h,
          AVG(CASE WHEN effective_time >= (SELECT d7 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_7d,
          AVG(effective_time - prev_time) AS last_30d
        FROM
          OrderedCanonicalBlocks
        WHERE
          prev_time IS NOT NULL
      `;
      const times = {
        last_1h: Number.parseFloat(avgBlockTimeQuery[0]?.last_1h ?? '0'),
        last_24h: Number.parseFloat(avgBlockTimeQuery[0]?.last_24h ?? '0'),
        last_7d: Number.parseFloat(avgBlockTimeQuery[0]?.last_7d ?? '0'),
        last_30d: Number.parseFloat(avgBlockTimeQuery[0]?.last_30d ?? '0'),
      };
      return times;
    });
  }

  async getBlockTransactions(
    args: BlockParams & TransactionPaginationQueryParams
  ): Promise<DbPaginatedResult<DbTx>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const filter =
        args.height_or_hash === 'latest'
          ? sql`index_block_hash = (SELECT index_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : CompiledBurnBlockHashParam(args.height_or_hash)
          ? sql`(
              block_hash = ${normalizeHashString(args.height_or_hash)}
              OR index_block_hash = ${normalizeHashString(args.height_or_hash)}
            )`
          : sql`block_height = ${args.height_or_hash}`;
      const blockCheck = await sql`SELECT index_block_hash FROM blocks WHERE ${filter} LIMIT 1`;
      if (blockCheck.count === 0)
        throw new InvalidRequestError(`Block not found`, InvalidRequestErrorType.invalid_param);
      const txsQuery = await sql<(TxQueryResult & { total: number })[]>`
        WITH tx_count AS (
          SELECT tx_count AS total FROM blocks WHERE canonical = TRUE AND ${filter}
        )
        SELECT ${sql(TX_COLUMNS)}, (SELECT total FROM tx_count)::int AS total
        FROM txs
        WHERE canonical = true
          AND microblock_canonical = true
          AND ${filter}
        ORDER BY microblock_sequence ASC, tx_index ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      if (txsQuery.count === 0)
        return {
          limit,
          offset,
          results: [],
          total: 0,
        };
      return {
        limit,
        offset,
        results: txsQuery.map(t => parseTxQueryResult(t)),
        total: txsQuery[0].total,
      };
    });
  }

  async getBurnBlocks(args: BlockPaginationQueryParams): Promise<DbPaginatedResult<DbBurnBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const blocksQuery = await sql<(DbBurnBlock & { total: number })[]>`
        WITH block_count AS (
          SELECT burn_block_height, block_count AS count FROM chain_tip
        )
        SELECT DISTINCT ON (burn_block_height)
          burn_block_time,
          burn_block_hash,
          burn_block_height,
          ARRAY_AGG(block_hash) OVER (
            PARTITION BY burn_block_height
            ORDER BY block_height DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS stacks_blocks,
          (SELECT count FROM block_count)::int AS total
        FROM blocks
        WHERE canonical = true
        ORDER BY burn_block_height DESC, block_height DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      return {
        limit,
        offset,
        results: blocksQuery,
        total: blocksQuery.count > 0 ? blocksQuery[0].total : 0,
      };
    });
  }

  async getBurnBlock(args: BlockParams): Promise<DbBurnBlock | undefined> {
    return await this.sqlTransaction(async sql => {
      const filter =
        args.height_or_hash === 'latest'
          ? sql`burn_block_hash = (SELECT burn_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : CompiledBurnBlockHashParam(args.height_or_hash)
          ? sql`burn_block_hash = ${args.height_or_hash}`
          : sql`burn_block_height = ${args.height_or_hash}`;
      const blockQuery = await sql<DbBurnBlock[]>`
        SELECT DISTINCT ON (burn_block_height)
          burn_block_time,
          burn_block_hash,
          burn_block_height,
          ARRAY_AGG(block_hash) OVER (
            PARTITION BY burn_block_height
            ORDER BY block_height DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS stacks_blocks
        FROM blocks
        WHERE canonical = true AND ${filter}
        LIMIT 1
      `;
      if (blockQuery.count > 0) return blockQuery[0];
    });
  }

  async getSmartContractStatus(args: SmartContractStatusParams): Promise<DbSmartContractStatus[]> {
    return await this.sqlTransaction(async sql => {
      const statusArray: DbSmartContractStatus[] = [];
      const contractArray = Array.isArray(args.contract_id) ? args.contract_id : [args.contract_id];

      // Search confirmed txs.
      const confirmed = await sql<DbSmartContractStatus[]>`
        SELECT DISTINCT ON (smart_contract_contract_id) smart_contract_contract_id, tx_id, block_height, status
        FROM txs
        WHERE type_id IN ${sql([DbTxTypeId.SmartContract, DbTxTypeId.VersionedSmartContract])}
          AND smart_contract_contract_id IN ${sql(contractArray)}
          AND canonical = TRUE
          AND microblock_canonical = TRUE
        ORDER BY smart_contract_contract_id, block_height DESC, microblock_sequence DESC, tx_index DESC, status
      `;
      statusArray.push(...confirmed);
      if (confirmed.count < contractArray.length) {
        // Search mempool txs.
        const confirmedIds = confirmed.map(c => c.smart_contract_contract_id);
        const remainingIds = contractArray.filter(c => !confirmedIds.includes(c));
        const mempool = await sql<DbSmartContractStatus[]>`
          SELECT DISTINCT ON (smart_contract_contract_id) smart_contract_contract_id, tx_id, status
          FROM mempool_txs
          WHERE pruned = FALSE
            AND type_id IN ${sql([DbTxTypeId.SmartContract, DbTxTypeId.VersionedSmartContract])}
            AND smart_contract_contract_id IN ${sql(remainingIds)}
          ORDER BY smart_contract_contract_id, nonce
        `;
        statusArray.push(...mempool);
      }

      return statusArray;
    });
  }

  async getAddressTransactions(
    args: AddressParams & TransactionPaginationQueryParams
  ): Promise<DbPaginatedResult<DbTxWithAddressTransfers>> {
    return await this.sqlTransaction(async sql => {
      await assertAddressExists(sql, args.address);
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;

      const eventCond = sql`
        tx_id = address_txs.tx_id
        AND index_block_hash = address_txs.index_block_hash
        AND microblock_hash = address_txs.microblock_hash
      `;
      const eventAcctCond = sql`
        ${eventCond} AND (sender = ${args.address} OR recipient = ${args.address})
      `;
      const resultQuery = await sql<(AddressTransfersTxQueryResult & { count: number })[]>`
        WITH address_txs AS (
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM principal_stx_txs
            WHERE principal = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM stx_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM ft_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM nft_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
        )
        SELECT
          ${sql(TX_COLUMNS)},
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM stx_events
            WHERE ${eventCond} AND sender = ${args.address}
          ) + txs.fee_rate AS stx_sent,
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM stx_events
            WHERE ${eventCond} AND recipient = ${args.address}
          ) AS stx_received,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS stx_transfer,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS stx_mint,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS stx_burn,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS ft_transfer,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS ft_mint,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS ft_burn,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS nft_transfer,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS nft_mint,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS nft_burn,
          (COUNT(*) OVER())::int AS count
        FROM address_txs
        INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
        WHERE canonical = TRUE AND microblock_canonical = TRUE
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = resultQuery.length > 0 ? resultQuery[0].count : 0;
      const parsed = resultQuery.map(r => parseAccountTransferSummaryTxQueryResult(r));
      return {
        total,
        limit,
        offset,
        results: parsed,
      };
    });
  }

  async getAddressTransactionEvents(
    args: AddressTransactionParams & TransactionPaginationQueryParams
  ): Promise<DbPaginatedResult<DbAddressTransactionEvent>> {
    return await this.sqlTransaction(async sql => {
      await assertAddressExists(sql, args.address);
      await assertTxIdExists(sql, args.tx_id);
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;

      const eventCond = sql`
        canonical = true
        AND microblock_canonical = true
        AND tx_id = ${args.tx_id}
        AND (sender = ${args.address} OR recipient = ${args.address})
      `;
      const results = await sql<(DbAddressTransactionEvent & { count: number })[]>`
        WITH events AS (
          (
            SELECT
              sender, recipient, event_index, amount, NULL as asset_identifier,
              NULL::bytea as value, ${DbEventTypeId.StxAsset}::int as event_type_id,
              asset_event_type_id
            FROM stx_events
            WHERE ${eventCond}
          )
          UNION
          (
            SELECT
              sender, recipient, event_index, amount, asset_identifier, NULL::bytea as value,
              ${DbEventTypeId.FungibleTokenAsset}::int as event_type_id, asset_event_type_id
            FROM ft_events
            WHERE ${eventCond}
          )
          UNION
          (
            SELECT
              sender, recipient, event_index, 0 as amount, asset_identifier, value,
              ${DbEventTypeId.NonFungibleTokenAsset}::int as event_type_id, asset_event_type_id
            FROM nft_events
            WHERE ${eventCond}
          )
        )
        SELECT *, COUNT(*) OVER()::int AS count
        FROM events
        ORDER BY event_index ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = results.length > 0 ? results[0].count : 0;
      return {
        total,
        limit,
        offset,
        results,
      };
    });
  }

  async getPoxCycles(args: PoxCyclePaginationQueryParams): Promise<DbPaginatedResult<DbPoxCycle>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxCycleLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const results = await sql<(PoxCycleQueryResult & { total: number })[]>`
        SELECT
          cycle_number, block_height, index_block_hash, total_weight, total_signers,
          total_stacked_amount, COUNT(*) OVER()::int AS total
        FROM pox_cycles
        WHERE canonical = TRUE
        ORDER BY cycle_number DESC
        OFFSET ${offset}
        LIMIT ${limit}
      `;
      const total = results.length > 0 ? results[0].total : 0;
      return {
        limit,
        offset,
        results: results,
        total,
      };
    });
  }

  async getPoxCycle(args: PoxCycleParams): Promise<DbPoxCycle | undefined> {
    return this.sqlTransaction(async sql => {
      const results = await sql<PoxCycleQueryResult[]>`
        SELECT
          cycle_number, block_height, index_block_hash, total_weight, total_signers,
          total_stacked_amount
        FROM pox_cycles
        WHERE canonical = TRUE AND cycle_number = ${args.cycle_number}
        LIMIT 1
      `;
      if (results.count > 0) return results[0];
    });
  }

  async getPoxCycleSigners(
    args: PoxCycleParams & PoxSignerPaginationQueryParams
  ): Promise<DbPaginatedResult<DbPoxCycleSigner>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxSignerLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const cycleCheck =
        await sql`SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${args.cycle_number} LIMIT 1`;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const results = await sql<(DbPoxCycleSigner & { total: number })[]>`
        SELECT
          signing_key, weight, stacked_amount, weight_percent, stacked_amount_percent,
          COUNT(*) OVER()::int AS total
        FROM pox_sets
        WHERE canonical = TRUE AND cycle_number = ${args.cycle_number}
        ORDER BY weight DESC, stacked_amount DESC, signing_key
        OFFSET ${offset}
        LIMIT ${limit}
      `;
      return {
        limit,
        offset,
        results: results,
        total: results.count > 0 ? results[0].total : 0,
      };
    });
  }

  async getPoxCycleSigner(args: PoxCycleSignerParams): Promise<DbPoxCycleSigner | undefined> {
    return this.sqlTransaction(async sql => {
      const cycleCheck =
        await sql`SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${args.cycle_number} LIMIT 1`;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const results = await sql<DbPoxCycleSigner[]>`
        SELECT
          signing_key, weight, stacked_amount, weight_percent, stacked_amount_percent
        FROM pox_sets
        WHERE canonical = TRUE AND cycle_number = ${args.cycle_number} AND signing_key = ${args.signer_key}
        LIMIT 1
      `;
      if (results.count > 0) return results[0];
    });
  }

  async getPoxCycleSignerStackers(
    args: PoxCycleSignerParams & PoxSignerPaginationQueryParams
  ): Promise<DbPaginatedResult<DbPoxCycleSignerStacker>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxSignerLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const cycleCheck = await sql`
        SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${args.cycle_number} LIMIT 1
      `;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const signerCheck = await sql`
        SELECT signing_key
        FROM pox_sets
        WHERE cycle_number = ${args.cycle_number} AND signing_key = ${args.signer_key}
        LIMIT 1
      `;
      if (signerCheck.count === 0)
        throw new InvalidRequestError(
          `PoX cycle signer not found`,
          InvalidRequestErrorType.invalid_param
        );
      const results = await sql<(DbPoxCycleSignerStacker & { total: number })[]>`
        WITH stackers AS (
          SELECT DISTINCT ON (stacker) stacker, locked, pox_addr
          FROM pox4_events
          WHERE canonical = true
            AND microblock_canonical = true
            AND start_cycle_id <= ${args.cycle_number}
            AND (end_cycle_id >= ${args.cycle_number} OR end_cycle_id IS NULL)
            AND signer_key = ${args.signer_key}
          ORDER BY stacker, block_height DESC, tx_index DESC, event_index DESC
        )
        SELECT *, COUNT(*) OVER()::int AS total FROM stackers
        OFFSET ${offset}
        LIMIT ${limit}
      `;
      return {
        limit,
        offset,
        results: results,
        total: results.count > 0 ? results[0].total : 0,
      };
    });
  }
}
