import { Static, Type } from '@sinclair/typebox';

export const AddressSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}$',
  title: 'Stacks Address',
  description: 'Stacks Address',
  examples: ['SP318Q55DEKHRXJK696033DQN5C54D9K2EE6DHRWP'],
});
export type Address = Static<typeof AddressSchema>;

export const SmartContractIdSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39}$',
  title: 'Smart Contract ID',
  description: 'Smart Contract ID',
  examples: ['SP000000000000000000002Q6VF78.pox-3'],
});
export type SmartContractId = Static<typeof SmartContractIdSchema>;

export const PrincipalSchema = Type.Union([AddressSchema, SmartContractIdSchema]);
export type Principal = Static<typeof PrincipalSchema>;

export const AssetIdentifierSchema = Type.String({
  pattern:
    '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}\\.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39}::[a-zA-Z]([a-zA-Z0-9]|[-_!?+<>=/*]){0,127}$',
  title: 'Asset Identifier',
  description: 'Asset Identifier',
  examples: ['SP000000000000000000002Q6VF78.pox-3::stx-token'],
});
export type AssetIdentifier = Static<typeof AssetIdentifierSchema>;

export const TransactionIdSchema = Type.String({
  pattern: '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Transaction ID',
  description: 'Transaction ID',
  examples: ['0xf6bd5f4a7b26184a3466340b2e99fd003b4962c0e382a7e4b6a13df3dd7a91c6'],
});
export type TransactionId = Static<typeof TransactionIdSchema>;

export const BlockHashSchema = Type.String({
  pattern: '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Block hash',
  description: 'Block hash',
  examples: ['0xdaf79950c5e8bb0c620751333967cdd62297137cdaf79950c5e8bb0c62075133'],
});
export type BlockHash = Static<typeof BlockHashSchema>;

export const BlockHeightSchema = Type.Integer({
  title: 'Block height',
  description: 'Block height',
  examples: [777678],
});
export type BlockHeight = Static<typeof BlockHeightSchema>;

export const BlockHeightOrHashSchema = Type.Union([
  Type.Literal('latest'),
  // Hash must come before height so the AJV union matches a hex string before attempting
  // integer coercion (which would otherwise turn '0x…deadbeef' into 3735928559).
  BlockHashSchema,
  BlockHeightSchema,
]);
export type BlockHeightOrHash = Static<typeof BlockHeightOrHashSchema>;

export const BondIndexSchema = Type.Integer({
  description: 'The index of the bond in the PoX-5 bond list',
});
export type BondIndex = Static<typeof BondIndexSchema>;

export const DecodedClarityValueSchema = Type.Object({
  hex: Type.String(),
  repr: Type.String(),
});
export type DecodedClarityValue = Static<typeof DecodedClarityValueSchema>;

export const DecodedStxTransferMemoSchema = Type.Object({
  hex: Type.String(),
  repr: Type.String(),
});
export type DecodedStxTransferMemo = Static<typeof DecodedStxTransferMemoSchema>;

export const ExecutionCostSchema = Type.Object({
  read_count: Type.Integer({
    description: 'Number of reads in the transaction',
  }),
  read_length: Type.Integer({
    description: 'Length of reads in the transaction',
  }),
  runtime: Type.Integer({
    description: 'Runtime of the transaction',
  }),
  write_count: Type.Integer({
    description: 'Number of writes in the transaction',
  }),
  write_length: Type.Integer({
    description: 'Length of writes in the transaction',
  }),
});
export type ExecutionCost = Static<typeof ExecutionCostSchema>;

/** The ISO 8601 rendering of a sibling unix-seconds `time` field, in UTC. */
export const TimeIsoSchema = Type.String({
  description: 'The `time` as an ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) UTC timestamp.',
  examples: ['2026-10-08T19:18:41.000Z'],
});

/**
 * When a schedule point's Bitcoin block was, or is projected to be, mined. Each pair is set or
 * `null` together, and at most one pair is set: `time` / `time_iso` once the block has been mined,
 * `projected_time` / `projected_time_iso` while it has not. Both pairs are `null` for a past block
 * no Stacks block anchored to, and for one too far in the future to date.
 */
export const SchedulePointTimesSchema = Type.Object({
  time: Type.Union([Type.Integer(), Type.Null()], {
    description:
      'Unix timestamp (in seconds) recorded in the Bitcoin block header, once the block has been ' +
      'mined. `null` for a block that has not been mined yet, and for a past block no Stacks ' +
      'block anchored to (the API learns Bitcoin block times only from the Stacks blocks ' +
      'anchored to them).',
  }),
  time_iso: Type.Union([Type.String(), Type.Null()], {
    description:
      'The `time` as an ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) UTC timestamp; `null` with it.',
    examples: ['2026-10-08T19:18:41.000Z'],
  }),
  projected_time: Type.Union([Type.Integer(), Type.Null()], {
    description:
      'Unix timestamp (in seconds) of when a future Bitcoin block is projected to be mined, ' +
      'extrapolated from the recent Bitcoin block pace (on mainnet, from the pace of the current ' +
      'difficulty period until its retarget, and the 10-minute target after it). Projections ' +
      'further out are less precise, by days for blocks months away. `null` once the block has ' +
      'been mined.',
  }),
  projected_time_iso: Type.Union([Type.String(), Type.Null()], {
    description:
      'The `projected_time` as an ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) UTC timestamp; `null` with ' +
      'it.',
    examples: ['2027-03-01T08:30:00.000Z'],
  }),
});
export type SchedulePointTimes = Static<typeof SchedulePointTimesSchema>;

export const BlockPositionSchema = Type.Object({
  height: Type.Integer({
    description: 'Height of the block this transactions was associated with',
  }),
  hash: Type.String({
    description: 'Hash of the blocked this transactions was associated with',
  }),
  index_hash: Type.String({
    description: 'Hash of the index block this transactions was associated with',
  }),
  time: Type.Number({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  time_iso: TimeIsoSchema,
  tx_index: Type.Integer({
    description:
      'Index of the transaction, indicating the order. Starts at `0` and increases with each transaction',
  }),
});
export type BlockPosition = Static<typeof BlockPositionSchema>;

export const BlockSummarySchema = Type.Object(
  {
    height: BlockHeightSchema,
    hash: BlockHashSchema,
    index_hash: Type.String({
      description: 'Index block hash of the block',
    }),
    time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
    time_iso: TimeIsoSchema,
  },
  { title: 'BlockSummary' }
);
export type BlockSummary = Static<typeof BlockSummarySchema>;

export const TransactionPositionSchema = Type.Object({
  tx_id: TransactionIdSchema,
  event_index: Type.Integer({
    description: 'Index of the event within the transaction',
  }),
});
export type TransactionPosition = Static<typeof TransactionPositionSchema>;

export const BitcoinBlockPositionSchema = Type.Object({
  height: Type.Integer({
    description: 'Height of the anchor burn block.',
  }),
  time: Type.Number({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  time_iso: TimeIsoSchema,
});
export type BitcoinBlockPosition = Static<typeof BitcoinBlockPositionSchema>;

export const AmountSchema = Type.String({
  pattern: '^[0-9]+$',
  title: 'Amount',
  description: 'Amount',
  examples: ['1000000'],
});
export type Amount = Static<typeof AmountSchema>;
