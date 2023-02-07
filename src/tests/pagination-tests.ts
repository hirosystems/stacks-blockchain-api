import { parsePagingQueryInput, getPagingQueryLimit, ResourceType } from '../api/pagination';

describe('parsePagingQueryInput()', () => {
  test('it returns same input when passed number', () => {
    expect(parsePagingQueryInput(8021991)).toEqual(8021991);
  });

  test('error is thrown when non-string value passed', () => {
    expect(() => parsePagingQueryInput(true)).toThrowError();
  });

  test('error is thrown on nonsense non-numerial input', () => {
    expect(() => parsePagingQueryInput('onehundredand2')).toThrowError();
  });

  test('string parsing works', () => {
    expect(parsePagingQueryInput('123')).toEqual(123);
  });
});

describe('getPagingQueryLimit()', () => {
  test('If a limit is not provided, the default limit is used for the specified route', () => {
    expect(getPagingQueryLimit(ResourceType.Block)).toBe(20);
  });
  test('Error is thrown when value is larger than input', () => {
    expect(() => getPagingQueryLimit(ResourceType.Block, 31)).toThrowError();
  });
  test('Error is NOT thrown when value is larger than input but a maxLimitOverride has been provided', () => {
    expect(() => getPagingQueryLimit(ResourceType.Tx, 100, 200)).not.toThrowError();
  });
});
