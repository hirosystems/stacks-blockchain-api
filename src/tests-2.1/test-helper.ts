import {
  Account,
  stackStxWithRosetta,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

/**
 * Run tests shifted to different points in a cycle.
 * `offset` refers to the offset/shift from the start of a cycle.
 * i.e. 0th, 1st, 2nd, etc. block of a cycle
 */
export function testRosettaStackWithOffset({
  account,
  offset,
}: {
  account: Account;
  offset: number;
}) {
  test('Standby for cycle block mod', async () => {
    const poxInfo = await testEnv.client.getPox();
    const startHeight = poxInfo.next_cycle.reward_phase_start_block_height + offset;

    await standByUntilBurnBlock(startHeight);
  });

  test('Rosetta - stack-stx tx', async () => {
    const poxInfo = await testEnv.client.getPox();
    const ustxAmount = BigInt(poxInfo.current_cycle.min_threshold_ustx * 1.2);

    expect((poxInfo.current_burnchain_block_height as number) % poxInfo.reward_cycle_length).toBe(
      offset
    );

    await stackStxWithRosetta({
      stacksAddress: account.stxAddr,
      privateKey: account.secretKey,
      pubKey: account.pubKey,
      cycleCount: 1,
      ustxAmount,
      btcAddr: account.btcAddr,
    });
  });

  test('Verify stacked', async () => {
    // Ensure node has had time to process
    const poxInfo = await testEnv.client.getPox();
    await standByUntilBurnBlock((poxInfo.current_burnchain_block_height as number) + 1);

    const coreBalance = await testEnv.client.getAccount(account.stxAddr);
    expect(coreBalance.unlock_height).toBeGreaterThan(0);
  });
}
