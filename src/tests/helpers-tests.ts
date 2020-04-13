import { getCurrentGitTag } from '../helpers';

test('get git tag', () => {
  const tag = getCurrentGitTag();
  expect(tag).toBeTruthy();
});
