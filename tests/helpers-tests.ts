import { getCurrentGitTag } from '../src/helpers';

test('get git tag', () => {
  const tag = getCurrentGitTag();
  expect(tag).toBeTruthy();
});
