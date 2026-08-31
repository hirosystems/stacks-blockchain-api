import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backfills the Clarity version of contracts deployed with an unversioned `SmartContract` payload.
 *
 * Two columns hold it. `smart_contracts.clarity_version` is the one the ABI sits next to;
 * `txs.smart_contract_clarity_version` is a denormalized copy (the `txs` table has no ABI column)
 * and is what the v3 smart contract endpoint reads, so both are patched.
 *
 * Rows whose ABI predates stacks-core adding `clarity_version` to the contract interface (Jan 2023)
 * have nothing to recover from, as do failed deploys, which have no interface at all. Those are set
 * to the sentinel `0`, which is not a real Clarity version, so the columns end up free of nulls for
 * every contract deploy and the API can serve a non-nullable field.
 */

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
 * (tx_id, index_block_hash, microblock_hash) rather than a scan of txs. Every copy of a tx across
 * re-org forks is patched, which is what we want.
 */
export const BACKFILL_TXS_SQL = `
  UPDATE txs t
  SET smart_contract_clarity_version = sc.clarity_version
  FROM smart_contracts sc
  WHERE t.tx_id = sc.tx_id
    AND t.smart_contract_clarity_version IS NULL
    AND sc.clarity_version IS NOT NULL
`;

/** Sentinel for a contract whose Clarity version could not be recovered. Not a real version. */
export const UNKNOWN_CLARITY_VERSION = 0;

/** Every `smart_contracts` row is a contract deploy, so anything still null gets the sentinel. */
export const DEFAULT_SMART_CONTRACTS_SQL = `
  UPDATE smart_contracts
  SET clarity_version = ${UNKNOWN_CLARITY_VERSION}
  WHERE clarity_version IS NULL
`;

/**
 * Scoped to contract-deploy transactions by `type_id` (which is indexed). Every other kind of
 * transaction has a legitimately null `smart_contract_clarity_version` and must be left alone.
 * `1` is `SmartContract`, `6` is `VersionedSmartContract` — a versioned deploy always carries its
 * own version, so in practice only the former matches.
 */
export const DEFAULT_TXS_SQL = `
  UPDATE txs
  SET smart_contract_clarity_version = ${UNKNOWN_CLARITY_VERSION}
  WHERE smart_contract_clarity_version IS NULL
    AND type_id IN (1, 6)
`;

export const up = (pgm: MigrationBuilder) => {
  pgm.sql(BACKFILL_SMART_CONTRACTS_SQL);
  pgm.sql(BACKFILL_TXS_SQL);
  pgm.sql(DEFAULT_SMART_CONTRACTS_SQL);
  pgm.sql(DEFAULT_TXS_SQL);
};

export const down = () => {
  // Deliberately irreversible. The backfilled values are recoveries of the version each contract
  // has always run under, and the nulls they replaced carry no information worth restoring.
};
