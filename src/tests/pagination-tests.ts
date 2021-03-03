import { parsePagingQueryInput, parseLimitQuery } from '../api/pagination';

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

describe('parseLimitQuery()', () => {
  test('error is thrown when value is larger than input', () => {
    const parseFn = parseLimitQuery({ maxItems: 20, errorMsg: 'Oh no, that is too many items' });
    expect(() => parseFn(21)).toThrowError();
  });
});
