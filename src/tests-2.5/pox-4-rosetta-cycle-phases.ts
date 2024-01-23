import { bytesToHex } from '@stacks/common';
import { randomBytes } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { stackStxWithRosetta, standByUntilBurnBlock, testEnv } from '../test-utils/test-helpers';

const REWARD_CYCLE_LENGTH = 5; // assuming regtest
const BLOCK_SHIFT_COUNT: { shift: number }[] = [];
for (let shift = 0; shift < REWARD_CYCLE_LENGTH; shift++) {
  BLOCK_SHIFT_COUNT.push({ shift });
}

const account = testnetKeys[1];
const btcAddr = '2N74VLxyT79VGHiBK2zEg3a9HJG7rEc5F3o';

describe.each(BLOCK_SHIFT_COUNT)(
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
        signerKey: bytesToHex(randomBytes(33)),
      });
    });

    test('Wait for unlock', async () => {
      const coreBalance = await testEnv.client.getAccount(account.stacksAddress);
      expect(coreBalance.unlock_height).toBeGreaterThan(0);

      await standByUntilBurnBlock(coreBalance.unlock_height + 1);
    });
  }
);
