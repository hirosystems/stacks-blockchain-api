import { timeout } from '@hirosystems/api-toolkit';
import { bytesToHex } from '@stacks/common';
import { BurnchainRewardSlotHolderListResponse } from '@stacks/stacks-blockchain-api-types';
import { randomBytes } from '@stacks/transactions';
import { testnetKeys } from '../api/routes/debug';
import { CoreRpcPoxInfo } from '../core-rpc/client';
import { DbTxStatus } from '../datastore/common';
import { getBitcoinAddressFromKey } from '../ec-helpers';
import {
  fetchGet,
  stackStxWithRosetta,
  standByUntilBurnBlock,
  testEnv,
} from '../test-utils/test-helpers';

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
  'PoX-4 - Rosetta - Stack with BTC address format $addressFormat',
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

    test('Standby for next cycle', async () => {
      poxInfo = await testEnv.client.getPox();
      await standByUntilBurnBlock(poxInfo.next_cycle.reward_phase_start_block_height); // a good time to stack
      // await standByForPoxCycle(); DON'T USE THIS!!! <cycle>.id is lying to you!
    });

    test('Perform stack-stx using Rosetta', async () => {
      poxInfo = await testEnv.client.getPox();
      expect(poxInfo.next_cycle.blocks_until_reward_phase).toBeGreaterThanOrEqual(
        poxInfo.reward_cycle_length - 1 // close to cycle start (1 block margin)
      );

      const ustxAmount = BigInt(Math.round(Number(poxInfo.min_amount_ustx) * 1.1).toString());
      const cycleCount = 1;

      const rosettaStackStx = await stackStxWithRosetta({
        btcAddr: bitcoinAddress,
        stacksAddress: account.stacksAddress,
        pubKey: account.pubKey,
        privateKey: account.secretKey,
        cycleCount,
        ustxAmount,
        signerKey: bytesToHex(randomBytes(33)),
      });
      expect(rosettaStackStx.tx.status).toBe(DbTxStatus.Success);
      expect(rosettaStackStx.constructionMetadata.metadata.contract_name).toBe('pox-4');
    });

    test('Validate reward set received', async () => {
      const nextCycleStart = poxInfo.next_cycle.reward_phase_start_block_height;

      await standByUntilBurnBlock(nextCycleStart); // time to check reward sets after a few blocks
      await timeout(3000); // make sure rewards have been processed

      poxInfo = await testEnv.client.getPox();
      const rewardSlotHolders = await fetchGet<BurnchainRewardSlotHolderListResponse>(
        `/extended/v1/burnchain/reward_slot_holders/${bitcoinAddress}`
      );
      expect(rewardSlotHolders.total).toBe(1);
      expect(rewardSlotHolders.results[0].address).toBe(bitcoinAddress);
      expect(rewardSlotHolders.results[0].burn_block_height).toBe(nextCycleStart + 1);
      // todo: is it correct that the reware slot is for the 2nd block of a reward phase?
    });
  }
);
