import { BasePgStoreModule } from '@hirosystems/api-toolkit';
import {
  BlockLimitParamSchema,
  CompiledBurnBlockHashParam,
  TransactionPaginationQueryParams,
  TransactionLimitParamSchema,
  BlockParams,
  BlockPaginationQueryParams,
  SmartContractStatusParams,
  PoxCyclePaginationQueryParams,
  PoxCycleLimitParamSchema,
  PoxCycleParams,
  PoxSignerPaginationQueryParams,
  PoxCycleSignerParams,
  PoxSignerLimitParamSchema,
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
  DbTxStatus,
  PoxCycleQueryResult,
  DbPoxCycle,
  DbPoxCycleSigner,
  DbPoxCycleSignerStacker,
} from './common';
import { BLOCK_COLUMNS, parseBlockQueryResult, TX_COLUMNS, parseTxQueryResult } from './helpers';

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
      const blocks = blocksQuery.map(r => r);
      return {
        limit,
        offset,
        results: blocks,
        total: blocks[0].total,
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
      return {
        limit,
        offset,
        results: results,
        total: results[0].total,
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
        total: results[0].total,
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
        total: results[0].total,
      };
    });
  }
}
