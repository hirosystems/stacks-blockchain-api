export function parsePagingQueryInput(val: any) {
  if (typeof val === 'number') {
    return val;
  }
  if (typeof val !== 'string') {
    throw new Error('Input must be either typeof `string` or `number`');
  }
  if (!/^\d+$/.test(val)) {
    throw new Error('`limit` and `offset` must be integers');
  }
  const parsedInput = parseInt(val, 10);
  if (isNaN(parsedInput)) throw new Error('Pagination value parsed as NaN');
  return parsedInput;
}

interface ParseLimitQueryParams {
  maxItems: number;
  errorMsg: string;
}

export function parseLimitQuery({ maxItems, errorMsg }: ParseLimitQueryParams) {
  return (val: any) => {
    const limit = parsePagingQueryInput(val);
    if (limit > maxItems) throw new Error(errorMsg);
    return limit;
  };
}
