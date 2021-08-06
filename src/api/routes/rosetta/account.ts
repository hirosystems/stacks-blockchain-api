import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore, DbBlock } from '../../../datastore/common';
import { has0xPrefix, FoundOrNot } from '../../../helpers';
import {
  NetworkIdentifier,
  RosettaAccount,
  RosettaBlockIdentifier,
  RosettaAccountBalanceResponse,
  RosettaSubAccount,
  AddressTokenOfferingLocked,
  AddressUnlockSchedule,
} from '@stacks/stacks-blockchain-api-types';
import { RosettaErrors, RosettaConstants, RosettaErrorsTypes } from '../../rosetta-constants';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { ChainID } from '@stacks/transactions';
import { StacksCoreRpcClient } from '../../../core-rpc/client';

export function createRosettaAccountRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/balance', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(500).json(makeRosettaError(valid));
      return;
    }

    const accountIdentifier: RosettaAccount = req.body.account_identifier;
    const subAccountIdentifier: RosettaSubAccount = req.body.account_identifier.sub_account;
    const blockIdentifier: RosettaBlockIdentifier = req.body.block_identifier;
    let blockQuery: FoundOrNot<DbBlock>;
    let blockHash: string = '0x';

    if (accountIdentifier === undefined) {
      return res.status(500).json(RosettaErrors[RosettaErrorsTypes.emptyAccountIdentifier]);
    }

    // we need to return the block height/hash in the response, so we
    // need to fetch the block first.
    if (blockIdentifier === undefined) {
      blockQuery = await db.getCurrentBlock();
    } else if (blockIdentifier.index > 0) {
      blockQuery = await db.getBlock({ height: blockIdentifier.index });
    } else if (blockIdentifier.hash !== undefined) {
      blockHash = blockIdentifier.hash;
      if (!has0xPrefix(blockHash)) {
        blockHash = '0x' + blockHash;
      }
      blockQuery = await db.getBlock({ hash: blockHash });
    } else {
      return res.status(500).json(RosettaErrors[RosettaErrorsTypes.invalidBlockIdentifier]);
    }

    if (!blockQuery.found) {
      return res.status(500).json(RosettaErrors[RosettaErrorsTypes.blockNotFound]);
    }

    const block = blockQuery.result;

    if (blockIdentifier?.hash !== undefined && block.block_hash !== blockIdentifier.hash) {
      return res.status(500).json(RosettaErrors[RosettaErrorsTypes.invalidBlockHash]);
    }

    const stxBalance = await db.getStxBalanceAtBlock(accountIdentifier.address, block.block_height);
    // return spendable balance (liquid) if no sub-account is specified
    let balance = (stxBalance.balance - stxBalance.locked).toString();

    const accountInfo = await new StacksCoreRpcClient().getAccount(accountIdentifier.address);

    const extra_metadata: any = {};

    if (subAccountIdentifier !== undefined) {
      switch (subAccountIdentifier.address) {
        case RosettaConstants.StackedBalance:
          const lockedBalance = stxBalance.locked;
          balance = lockedBalance.toString();
          break;
        case RosettaConstants.SpendableBalance:
          const spendableBalance = stxBalance.balance - stxBalance.locked;
          balance = spendableBalance.toString();
          break;
        case RosettaConstants.VestingLockedBalance:
        case RosettaConstants.VestingUnlockedBalance:
          const stxVesting = await db.getTokenOfferingLocked(
            accountIdentifier.address,
            block.block_height
          );
          if (stxVesting.found) {
            const vestingInfo = getVestingInfo(stxVesting.result);
            balance = vestingInfo[subAccountIdentifier.address].toString();
            extra_metadata[RosettaConstants.VestingSchedule] =
              vestingInfo[RosettaConstants.VestingSchedule];
          } else {
            balance = '0';
          }
          break;
        default:
          return res.status(500).json(RosettaErrors[RosettaErrorsTypes.invalidSubAccount]);
      }
    }

    const response: RosettaAccountBalanceResponse = {
      block_identifier: {
        index: block.block_height,
        hash: block.block_hash,
      },
      balances: [
        {
          value: balance,
          currency: {
            symbol: RosettaConstants.symbol,
            decimals: RosettaConstants.decimals,
          },
          metadata: Object.keys(extra_metadata).length > 0 ? extra_metadata : undefined,
        },
      ],
      metadata: {
        sequence_number: accountInfo.nonce ? accountInfo.nonce : 0,
      },
    };

    res.json(response);
  });

  return router;
}

function getVestingInfo(info: AddressTokenOfferingLocked): { [key: string]: string | string[] } {
  const vestingData: { [key: string]: string | string[] } = {};
  const jsonVestingSchedule: string[] = [];
  info.unlock_schedule.forEach(schedule => {
    const item = { amount: schedule.amount, unlock_height: schedule.block_height };
    jsonVestingSchedule.push(JSON.stringify(item));
  });

  vestingData[RosettaConstants.VestingLockedBalance] = info.total_locked;
  vestingData[RosettaConstants.VestingUnlockedBalance] = info.total_unlocked;
  vestingData[RosettaConstants.VestingSchedule] = jsonVestingSchedule;
  return vestingData;
}
