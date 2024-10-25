import { InvalidRequestError, InvalidRequestErrorType } from '../errors';

export function parsePagingQueryInput(val: any) {
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val !== 'string') {
    throw new InvalidRequestError(
      'Input must be either typeof `string` or `number`',
      InvalidRequestErrorType.invalid_query
    );
  }
  if (!/^\d+$/.test(val)) {
    throw new InvalidRequestError(
      '`limit` and `offset` must be integers',
      InvalidRequestErrorType.invalid_query
    );
  }
  const parsedInput = parseInt(val, 10);
  if (isNaN(parsedInput))
    throw new InvalidRequestError(
      'Pagination value parsed as NaN',
      InvalidRequestErrorType.invalid_query
    );
  return parsedInput;
}

export enum ResourceType {
  Block,
  Tx,
  Event,
  Burnchain,
  Contract,
  Microblock,
  Token,
  Pox2Event,
  Stacker,
  BurnBlock,
  Signer,
  PoxCycle,
  TokenHolders,
  BlockSignerSignature,
}

export const pagingQueryLimits: Record<ResourceType, { defaultLimit: number; maxLimit: number }> = {
  [ResourceType.Block]: {
    defaultLimit: 20,
    maxLimit: 30,
  },
  [ResourceType.BurnBlock]: {
    defaultLimit: 20,
    maxLimit: 30,
  },
  [ResourceType.Tx]: {
    defaultLimit: 20,
    maxLimit: 50,
  },
  [ResourceType.Event]: {
    defaultLimit: 20,
    maxLimit: 100,
  },
  [ResourceType.Burnchain]: {
    defaultLimit: 96,
    maxLimit: 250,
  },
  [ResourceType.Contract]: {
    defaultLimit: 20,
    maxLimit: 50,
  },
  [ResourceType.Microblock]: {
    defaultLimit: 20,
    maxLimit: 200,
  },
  [ResourceType.Token]: {
    defaultLimit: 50,
    maxLimit: 200,
  },
  [ResourceType.Pox2Event]: {
    defaultLimit: 96,
    maxLimit: 200,
  },
  [ResourceType.Stacker]: {
    defaultLimit: 100,
    maxLimit: 200,
  },
  [ResourceType.Signer]: {
    defaultLimit: 100,
    maxLimit: 250,
  },
  [ResourceType.PoxCycle]: {
    defaultLimit: 20,
    maxLimit: 60,
  },
  [ResourceType.TokenHolders]: {
    defaultLimit: 100,
    maxLimit: 200,
  },
  [ResourceType.BlockSignerSignature]: {
    defaultLimit: 500,
    maxLimit: 1000,
  },
};

export function getPagingQueryLimit(
  resourceType: ResourceType,
  limitOverride?: any,
  maxLimitOverride?: number
) {
  const pagingQueryLimit = pagingQueryLimits[resourceType];
  if (!limitOverride) {
    return pagingQueryLimit.defaultLimit;
  }
  const newLimit = parsePagingQueryInput(limitOverride);
  const maxLimit = maxLimitOverride ?? pagingQueryLimit.maxLimit;
  if (newLimit > maxLimit) {
    throw new InvalidRequestError(
      `'limit' must be equal to or less than ${pagingQueryLimit.maxLimit}`,
      InvalidRequestErrorType.invalid_query
    );
  }
  return newLimit;
}
