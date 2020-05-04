import { getCurrentGitTag, has0xPrefix } from '../helpers';

test('get git tag', () => {
  const tag = getCurrentGitTag();
  expect(tag).toBeTruthy();
});

describe('has0xPrefix()', () => {
  test('falsy case, where there be no 0x', () => {
    expect(has0xPrefix('la-la, no prefixie here')).toEqual(false);
  });

  test('it returns true when there is, infact, a 0x prefix', () => {
    expect(has0xPrefix('0xlkjsdkljskljdkjlsdfkljs')).toEqual(true);
  });
});
