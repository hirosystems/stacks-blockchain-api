import { testnetKeys } from '../../src/api/routes/debug';
import { stackStxWithRosetta, standByUntilBurnBlock, testEnv } from '../utils/test-helpers';

const REWARD_CYCLE_LENGTH = 5; // assuming regtest
const BLOCK_SHIFT_COUNT: { shift: number }[] = [];
BLOCK_SHIFT_COUNT.push(...Array.from({ length: REWARD_CYCLE_LENGTH }, (_, shift) => ({ shift })));

const account = testnetKeys[1];
const btcAddr = '2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o';

const signerPrivKey = '929c9b8581473c67df8a21c2a4a12f74762d913dd39d91295ee96e779124bca9';
const signerPubKey = '033b67384665cbc3a36052a2d1c739a6cd1222cd451c499400c9d42e2041a56161';

// skipped:
// right now, these tests often run into timing issues, so they are skipped.
// rosetta calls aren't all finished yet, while the chain has advanced by one.
// in some cases this is fast enough that the test will be successful again,
// even though it doesn't test what it should. in others, it will fail.
// a potential solution would be to somehow control when the chain advances.
describe.skip.each(BLOCK_SHIFT_COUNT)(
  'PoX-4 - Rosetta - Stack on any phase of cycle $shift',
  ({ shift }) => {
    test('Standby for cycle phase', async () => {
      const poxInfo = await testEnv.client.getPox();

      const blocksUntilNextCycle =
        poxInfo.next_cycle.blocks_until_reward_phase % poxInfo.reward_cycle_length;
      const startHeight =
        (poxInfo.current_burnchain_block_height as number) + blocksUntilNextCycle + shift;

      if (startHeight !== poxInfo.current_burnchain_block_height) {
        // only stand-by if we're not there yet
        await standByUntilBurnBlock(startHeight);
      }
    });

    test('Rosetta - stack-stx tx', async () => {
      const poxInfo = await testEnv.client.getPox();
      const ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);
      expect((poxInfo.current_burnchain_block_height as number) % poxInfo.reward_cycle_length).toBe(
        shift
      );

      await stackStxWithRosetta({
        stacksAddress: account.stacksAddress,
        privateKey: account.secretKey,
        pubKey: account.pubKey,
        cycleCount: 1,
        ustxAmount,
        btcAddr,
        signerKey: signerPubKey,
        signerPrivKey: signerPrivKey,
      });
    });

    test('Wait for unlock', async () => {
      const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
      expect(coreBalance.unlock_height).toBeGreaterThan(0);

      await standByUntilBurnBlock(coreBalance.unlock_height + 1);
    });
  }
);
