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

interface ParseLimitQueryParams {
  maxItems: number;
  errorMsg: string;
}

export function parseLimitQuery({ maxItems, errorMsg }: ParseLimitQueryParams) {
  return (val: any) => {
    const limit = parsePagingQueryInput(val);
    if (limit > maxItems)
      throw new InvalidRequestError(errorMsg, InvalidRequestErrorType.invalid_query);
    return limit;
  };
}
