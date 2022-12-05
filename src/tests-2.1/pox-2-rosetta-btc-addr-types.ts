import { getBitcoinAddressFromKey } from '../ec-helpers';
import { testnetKeys } from '../api/routes/debug';
import {
  fetchGet,
  stackStxWithRosetta,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbTxStatus } from '../datastore/common';
import { BurnchainRewardSlotHolderListResponse } from '@stacks/stacks-blockchain-api-types';

const BTC_ADDRESS_CASES = [
  { addressFormat: 'p2pkh' },
  { addressFormat: 'p2sh' },
  { addressFormat: 'p2sh-p2wpkh' },
  { addressFormat: 'p2sh-p2wsh' },
  { addressFormat: 'p2wpkh' },
  { addressFormat: 'p2wsh' },
  { addressFormat: 'p2tr' },
] as const;

describe.each(BTC_ADDRESS_CASES)(
  'PoX-2 - Rosetta - Stack with BTC address format $addressFormat',
  ({ addressFormat }) => {
    let poxInfo: CoreRpcPoxInfo;
    const account = testnetKeys[1];
    let bitcoinAddress: string;

    beforeAll(() => {
      bitcoinAddress = getBitcoinAddressFromKey({
        privateKey: account.secretKey,
        network: 'testnet',
        addressFormat,
      });
    });

    test('Standby until unlocked', async () => {
      poxInfo = await testEnv.client.getPox();
      const coreBalance = await testEnv.client.getAccount(account.stacksAddress);

      // Wait until unlocked or start of new cycle
      if (coreBalance.unlock_height > 0) {
        await standByUntilBurnBlock(coreBalance.unlock_height + 1);
      } else if (poxInfo.next_cycle.blocks_until_reward_phase == 1) {
        await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height);
      }
    });

    test('Perform stack-stx using Rosetta', async () => {
      const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      const cycleCount = 1;

      const rosettaStackStx = await stackStxWithRosetta({
        btcAddr: bitcoinAddress,
        stacksAddress: account.stacksAddress,
        pubKey: account.pubKey,
        privateKey: account.secretKey,
        cycleCount,
        ustxAmount,
      });
      expect(rosettaStackStx.tx.status).toBe(DbTxStatus.Success);
      expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-2');
    });

    test('Validate reward set received', async () => {
      // Checks which rewards have been paid out; Pay-out to our registered
      // address happens for the 1st block of the reward cycle.
      // Due to timing issues, this test waits for an extra block until it
      // queries the reward set pay-outs. But, it still verifies the correct
      // pay-out block height.

      poxInfo = await testEnv.client.getPox();
      const thirdBlockOfNextRewardCycle = poxInfo.next_cycle.reward_phase_start_block_height + 2;

      await standByUntilBurnBlock(thirdBlockOfNextRewardCycle);

      poxInfo = await testEnv.client.getPox();

      // Verify we're at least on the 3rd block of the cycle
      expect(poxInfo.current_burnchain_block_height).toBeGreaterThanOrEqual(
        thirdBlockOfNextRewardCycle
      );

      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${bitcoinAddress}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(bitcoinAddress);
      expect(rewardSlotHolders.results[0].burn_block_height).toBe(
        thirdBlockOfNextRewardCycle - 1 // expecting the event to come in on second burn block of cycle
      );
    });
  }
);
