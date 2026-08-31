import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Recovers the version from the ABI. It is serialized as the `ClarityVersion` enum variant name,
 * e.g. `Clarity3`.
 */
export const BACKFILL_SMART_CONTRACTS_SQL = `
  UPDATE smart_contracts
  SET clarity_version =
    CAST(substring(abi->>'clarity_version' FROM '^Clarity([0-9]+)$') AS smallint)
  WHERE clarity_version IS NULL
    AND jsonb_typeof(abi) = 'object'
    AND abi->>'clarity_version' ~ '^Clarity[0-9]+$'
`;

/**
 * Copies the recovered version onto the tx rows. Driven from the (much smaller) smart_contracts
 * side, so this is an index lookup per contract against the unique index on txs
 * (tx_id, index_block_hash, microblock_hash) rather than a scan of txs.
 *
 * Matched on that full location tuple rather than `tx_id` alone. A transaction retained on several
 * forks has one row per fork in both tables, so a `tx_id`-only join is a cross product and
 * Postgres would update each `txs` copy from an arbitrary `smart_contracts` row. Those rows can
 * legitimately disagree: an unversioned deploy re-executed across an epoch boundary resolves to a
 * different Clarity version on either side. Every copy is still patched, each from its own fork.
 */
export const BACKFILL_TXS_SQL = `
  UPDATE txs t
  SET smart_contract_clarity_version = sc.clarity_version
  FROM smart_contracts sc
  WHERE t.tx_id = sc.tx_id
    AND t.index_block_hash = sc.index_block_hash
    AND t.microblock_hash = sc.microblock_hash
    AND t.smart_contract_clarity_version IS NULL
    AND sc.clarity_version IS NOT NULL
`;

/**
 * Backfills the Clarity version of contracts deployed with an unversioned `SmartContract` payload.
 *
 * Such a payload carries no Clarity version on the wire (the node resolves it from the epoch at
 * execution time) so the API recorded `null` for every one of them. The node does report the
 * resolved version in the contract interface it sends to event observers, and that whole blob is
 * already stored in `smart_contracts.abi`, so the value can be recovered without touching the node.
 *
 * Two columns hold it. `smart_contracts.clarity_version` is the one the ABI sits next to;
 * `txs.smart_contract_clarity_version` is a denormalized copy (the `txs` table has no ABI column)
 * and is what the v3 smart contract endpoint reads, so both are patched.
 *
 * Rows whose ABI predates stacks-core adding `clarity_version` to the contract interface (Jan 2023)
 * have nothing to recover from and stay null, as do failed deploys, which have no interface at all.
 * In practice that should not happen here: a node re-syncing from genesis rebuilds every contract
 * interface with the current binary, so a chainstate synced any time after Jan 2023 has the version
 * for even the oldest contracts. Nulls only survive on a chainstate descending from an older
 * archive, since event-replay reproduces the original payloads verbatim.
 */
export const up = (pgm: MigrationBuilder) => {
  pgm.sql(BACKFILL_SMART_CONTRACTS_SQL);
  pgm.sql(BACKFILL_TXS_SQL);
};

export const down = () => {
  // Deliberately irreversible. The backfilled values are recoveries of the version each contract
  // has always run under, and the nulls they replaced carry no information worth restoring.
};
