import { testnetKeys } from '../api/routes/debug';
import { accountFromKey } from '../test-utils/test-helpers';
import { testRosettaStackWithOffset } from './reusable-tests';

// Assuming a reward cycle length of 5
describe('PoX-2 - Rosetta - Stack in cycle, offset by 2', () => {
  const account = accountFromKey(testnetKeys[1].secretKey);
  testRosettaStackWithOffset({ account, offset: 2 });
});
