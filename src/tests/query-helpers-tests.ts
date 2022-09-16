import { parseTimestampQueryInput } from '../api/query-helpers';

describe('parseTimestampQueryInput()', () => {
  test('it returns same input when passed a valid timestamp number', () => {
    expect(parseTimestampQueryInput(1663364033)).toEqual(1663364033);
  });

  test('it returns same input when passed a valid timestamp string', () => {
    expect(parseTimestampQueryInput('1663364033')).toEqual(1663364033);
  });

  test('error is thrown if input is neither number nor string', () => {
    expect(() => parseTimestampQueryInput(true)).toThrowError();
  });

  test('error is thrown if input is not a valid timestamp', () => {
    expect(() => parseTimestampQueryInput(99999999999999)).toThrowError();
    expect(() => parseTimestampQueryInput('abc')).toThrowError();
  });
});
