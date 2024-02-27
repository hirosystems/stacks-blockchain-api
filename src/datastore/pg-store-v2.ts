import { BasePgStoreModule } from '@hirosystems/api-toolkit';
import {
  BlockLimitParamSchema,
  CompiledBurnBlockHashParam,
  TransactionPaginationQueryParams,
  TransactionLimitParamSchema,
  BlockParams,
  BlockPaginationQueryParams,
  SmartContractStatusParams,
  AddressParams,
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
  AccountTransferSummaryTxQueryResult,
  DbTxWithAccountTransferSummary,
} from './common';
import {
  BLOCK_COLUMNS,
  parseBlockQueryResult,
  TX_COLUMNS,
  parseTxQueryResult,
  parseAccountTransferSummaryTxQueryResult,
} from './helpers';

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

  async getAddressTransactions(
    args: AddressParams & TransactionPaginationQueryParams
  ): Promise<DbPaginatedResult<DbTxWithAccountTransferSummary>> {
    return await this.sqlTransaction(async sql => {
      const addressCheck =
        await sql`SELECT principal FROM principal_stx_txs WHERE principal = ${args.address} LIMIT 1`;
      if (addressCheck.count === 0)
        throw new InvalidRequestError(`Address not found`, InvalidRequestErrorType.invalid_param);
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;

      const eventCond = sql`
        tx_id = stx_txs.tx_id
        AND index_block_hash = stx_txs.index_block_hash
        AND microblock_hash = stx_txs.microblock_hash
      `;
      const eventAcctCond = sql`
        ${eventCond} AND (sender = ${args.address} OR recipient = ${args.address})
      `;
      const resultQuery = await this.sql<
        (AccountTransferSummaryTxQueryResult & { count: number })[]
      >`
        WITH stx_txs AS (
          SELECT tx_id, index_block_hash, microblock_hash, (COUNT(*) OVER())::int AS count
          FROM principal_stx_txs
          WHERE principal = ${args.address}
            AND canonical = TRUE
            AND microblock_canonical = TRUE
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT ${limit}
          OFFSET ${offset}
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
          (SELECT COUNT(*)::int FROM stx_events WHERE ${eventAcctCond}) AS stx_transfers,
          (SELECT COUNT(*)::int FROM ft_events WHERE ${eventAcctCond}) AS ft_transfers,
          (SELECT COUNT(*)::int FROM nft_events WHERE ${eventAcctCond}) AS nft_transfers,
          count
        FROM stx_txs
        INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
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
}
