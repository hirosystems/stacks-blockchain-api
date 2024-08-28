import { Type, Static, TSchema } from '@sinclair/typebox';
import { ResourceType, pagingQueryLimits } from '../../../api/pagination';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { has0xPrefix, isTestEnv } from '@hirosystems/api-toolkit';

const ajv = addFormats(new Ajv({ coerceTypes: true }), [
  'date-time',
  'time',
  'date',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uri',
  'uri-reference',
  'uuid',
  'uri-template',
  'json-pointer',
  'relative-json-pointer',
  'regex',
]);

// ==========================
// Parameters
// ==========================

const OffsetParamSchema = Type.Integer({
  minimum: 0,
  title: 'Offset',
  description: 'Result offset',
});

export const BlockLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Block].maxLimit,
  default: pagingQueryLimits[ResourceType.Block].defaultLimit,
  title: 'Block limit',
  description: 'Blocks per page',
});

export const TransactionLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Tx].maxLimit,
  default: pagingQueryLimits[ResourceType.Tx].defaultLimit,
  title: 'Transaction limit',
  description: 'Transactions per page',
});

export const PoxCycleLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.PoxCycle].maxLimit,
  default: pagingQueryLimits[ResourceType.PoxCycle].defaultLimit,
  title: 'PoX cycle limit',
  description: 'PoX cycles per page',
});

export const PoxSignerLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Signer].maxLimit,
  default: pagingQueryLimits[ResourceType.Signer].defaultLimit,
  title: 'PoX signer limit',
  description: 'PoX signers per page',
});

export type BlockIdParam =
  | { type: 'height'; height: number }
  | { type: 'hash'; hash: string }
  | { type: 'latest'; latest: true };

export function parseBlockParam(value: string | number): BlockIdParam {
  if (value === 'latest') {
    return { type: 'latest', latest: true };
  }
  value = typeof value === 'string' ? value : value.toString();
  if (/^(0x)?[a-fA-F0-9]{64}$/i.test(value)) {
    return { type: 'hash', hash: has0xPrefix(value) ? value : `0x${value}` };
  }
  if (/^[0-9]+$/.test(value)) {
    return { type: 'height', height: parseInt(value) };
  }
  throw new Error('Invalid block height or hash');
}

/**
 * If a param can accept a block hash or height, then ensure that the hash is prefixed with '0x' so
 * that hashes with only digits are not accidentally parsed as a number.
 */
export function cleanBlockHeightOrHashParam(params: { height_or_hash: string | number }) {
  if (
    typeof params.height_or_hash === 'string' &&
    /^[a-fA-F0-9]{64}$/i.test(params.height_or_hash)
  ) {
    params.height_or_hash = '0x' + params.height_or_hash;
  }
}

const BurnBlockHashParamSchema = Type.String({
  pattern: isTestEnv ? undefined : '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Burn block hash',
  description: 'Burn block hash',
  examples: ['0000000000000000000452773967cdd62297137cdaf79950c5e8bb0c62075133'],
});
export const CompiledBurnBlockHashParam = ajv.compile(BurnBlockHashParamSchema);

const BurnBlockHeightParamSchema = Type.Integer({
  title: 'Burn block height',
  description: 'Burn block height',
  examples: [777678],
});

const BlockHeightParamSchema = Type.Integer({
  title: 'Block height',
  description: 'Block height',
  examples: [777678],
});

const BlockHashParamSchema = Type.String({
  pattern: isTestEnv ? undefined : '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Block hash',
  description: 'Block hash',
  examples: ['daf79950c5e8bb0c620751333967cdd62297137cdaf79950c5e8bb0c62075133'],
});

const AddressParamSchema = Type.String({
  pattern: isTestEnv ? undefined : '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}',
  title: 'STX Address',
  description: 'STX Address',
  examples: ['SP318Q55DEKHRXJK696033DQN5C54D9K2EE6DHRWP'],
});

const SmartContractIdParamSchema = Type.String({
  pattern: isTestEnv
    ? undefined
    : '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39}$',
  title: 'Smart Contract ID',
  description: 'Smart Contract ID',
  examples: ['SP000000000000000000002Q6VF78.pox-3'],
});

const TransactionIdParamSchema = Type.String({
  pattern: isTestEnv ? undefined : '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Transaction ID',
  description: 'Transaction ID',
  examples: ['0xf6bd5f4a7b26184a3466340b2e99fd003b4962c0e382a7e4b6a13df3dd7a91c6'],
});

// ==========================
// Query and path params
// TODO: Migrate these to each endpoint after switching from Express to Fastify
// ==========================

const PaginationQueryParamsSchema = <T extends TSchema>(t: T) =>
  Type.Object(
    {
      limit: Type.Optional(t),
      offset: Type.Optional(OffsetParamSchema),
    },
    { additionalProperties: false }
  );

const BlockPaginationQueryParamsSchema = PaginationQueryParamsSchema(BlockLimitParamSchema);
export type BlockPaginationQueryParams = Static<typeof BlockPaginationQueryParamsSchema>;

const TransactionPaginationQueryParamsSchema = PaginationQueryParamsSchema(
  TransactionLimitParamSchema
);
export type TransactionPaginationQueryParams = Static<
  typeof TransactionPaginationQueryParamsSchema
>;

const PoxCyclePaginationQueryParamsSchema = PaginationQueryParamsSchema(PoxCycleLimitParamSchema);
export type PoxCyclePaginationQueryParams = Static<typeof PoxCyclePaginationQueryParamsSchema>;

const PoxSignerPaginationQueryParamsSchema = PaginationQueryParamsSchema(PoxSignerLimitParamSchema);
export type PoxSignerPaginationQueryParams = Static<typeof PoxSignerPaginationQueryParamsSchema>;

export const BlockParamsSchema = Type.Object(
  {
    height_or_hash: Type.Union([
      Type.Literal('latest'),
      BlockHashParamSchema,
      BlockHeightParamSchema,
    ]),
  },
  { additionalProperties: false }
);
export type BlockParams = Static<typeof BlockParamsSchema>;

export const BurnBlockParamsSchema = Type.Object(
  {
    height_or_hash: Type.Union([
      Type.Literal('latest'),
      BurnBlockHashParamSchema,
      BurnBlockHeightParamSchema,
    ]),
  },
  { additionalProperties: false }
);
export type BurnBlockParams = Static<typeof BurnBlockParamsSchema>;

export const SmartContractStatusParamsSchema = Type.Object(
  {
    contract_id: Type.Union([Type.Array(SmartContractIdParamSchema), SmartContractIdParamSchema]),
  },
  { additionalProperties: false }
);
export type SmartContractStatusParams = Static<typeof SmartContractStatusParamsSchema>;

export const AddressParamsSchema = Type.Object(
  { address: Type.Union([AddressParamSchema, SmartContractIdParamSchema]) },
  { additionalProperties: false }
);
export type AddressParams = Static<typeof AddressParamsSchema>;

export const AddressTransactionParamsSchema = Type.Object(
  {
    address: Type.Union([AddressParamSchema, SmartContractIdParamSchema]),
    tx_id: TransactionIdParamSchema,
  },
  { additionalProperties: false }
);
export type AddressTransactionParams = Static<typeof AddressTransactionParamsSchema>;
