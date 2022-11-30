import { testnetKeys } from '../api/routes/debug';
import { stackStxWithRosetta, standByUntilBurnBlock, testEnv } from '../test-utils/test-helpers';

describe('PoX-2 - Rosetta - Stack on any phase of cycle', () => {
  const account = testnetKeys[1];
  const btcAddr = '2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o';

  const REWARD_CYCLE_LENGTH = 5; // assuming regtest
  for (let shift = 0; shift < REWARD_CYCLE_LENGTH; shift++) {
    test('Rosetta - stack-stx tx', async () => {
      let poxInfo = await testEnv.client.getPox();

      const blocksUntilNextCycle =
        poxInfo.next_cycle.blocks_until_reward_phase % poxInfo.reward_cycle_length;
      const startHeight =
        (poxInfo.current_burnchain_block_height as number) + blocksUntilNextCycle + shift;

      if (startHeight !== poxInfo.current_burnchain_block_height) {
        // only stand-by if we're not there yet
        await standByUntilBurnBlock(startHeight);
      }

      poxInfo = await testEnv.client.getPox();
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
      });

      const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
      expect(coreBalance.unlock_height).toBeGreaterThan(0);

      await standByUntilBurnBlock(coreBalance.unlock_height + 1);
    });
  }
});
