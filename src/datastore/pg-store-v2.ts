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
}
