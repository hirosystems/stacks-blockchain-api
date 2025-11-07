import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DbBlock } from '../../../datastore/common';
import { PgStore } from '../../../datastore/pg-store';
import { FoundOrNot, ChainID } from '../../../helpers';
import {
  RosettaAccount,
  RosettaBlockIdentifier,
  RosettaAccountBalanceResponse,
  RosettaSubAccount,
  RosettaAmount,
} from '../../../rosetta/types';
import { RosettaErrors, RosettaConstants, RosettaErrorsTypes } from '../../rosetta-constants';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { has0xPrefix } from '@hirosystems/api-toolkit';
import { RosettaFtMetadataClient } from '../../../rosetta/rosetta-ft-metadata-client';
import { AddressTokenOfferingLocked } from '../../schemas/entities/addresses';

export function createRosettaAccountRouter(db: PgStore, chainId: ChainID): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.post(
    '/balance',
    asyncHandler(async (req, res) => {
      const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
      if (!valid.valid) {
        res.status(400).json(makeRosettaError(valid));
        return;
      }

      const accountIdentifier: RosettaAccount = req.body.account_identifier;
      const subAccountIdentifier: RosettaSubAccount = req.body.account_identifier.sub_account;
      const blockIdentifier: RosettaBlockIdentifier = req.body.block_identifier;

      await db
        .sqlTransaction(async sql => {
          let blockQuery: FoundOrNot<DbBlock>;
          let blockHash: string = '0x';
          let atChainTip: boolean = false;
          // we need to return the block height/hash in the response, so we
          // need to fetch the block first.
          if (
            (!blockIdentifier?.hash && !blockIdentifier?.index) ||
            (blockIdentifier && blockIdentifier.index <= 0)
          ) {
            blockQuery = await db.getCurrentBlock();
            atChainTip = true;
          } else if (blockIdentifier.index > 0) {
            blockQuery = await db.getBlock({ height: blockIdentifier.index });
          } else if (blockIdentifier.hash !== undefined) {
            blockHash = blockIdentifier.hash;
            if (!has0xPrefix(blockHash)) {
              blockHash = '0x' + blockHash;
            }
            blockQuery = await db.getBlock({ hash: blockHash });
          } else {
            throw RosettaErrors[RosettaErrorsTypes.invalidBlockIdentifier];
          }

          if (!blockQuery.found) {
            throw RosettaErrors[RosettaErrorsTypes.blockNotFound];
          }

          const block = blockQuery.result;

          if (blockIdentifier?.hash !== undefined && block.block_hash !== blockIdentifier.hash) {
            throw RosettaErrors[RosettaErrorsTypes.invalidBlockHash];
          }

          let rawBalance = 0n;
          let locked = 0n;

          // Fetch chain tip balance from pre-computed table when possible.
          if (atChainTip) {
            const stxBalancesResult = await db.v2.getStxHolderBalance({
              sql,
              stxAddress: accountIdentifier.address,
            });
            rawBalance = stxBalancesResult.found ? stxBalancesResult.result.balance : 0n;
            const stxPoxLockedResult = await db.v2.getStxPoxLockedAtBlock({
              sql,
              stxAddress: accountIdentifier.address,
              blockHeight: block.block_height,
              burnBlockHeight: block.burn_block_height,
            });
            locked = stxPoxLockedResult.locked;
          } else {
            const stxBalance = await db.getStxBalanceAtBlock(
              accountIdentifier.address,
              block.block_height
            );
            rawBalance = stxBalance.balance;
            locked = stxBalance.locked;
          }
          let balance = rawBalance - locked;

          const accountNonceQuery = await db.getAddressNonceAtBlock({
            stxAddress: accountIdentifier.address,
            blockIdentifier: { height: block.block_height },
          });
          const sequenceNumber = accountNonceQuery.found
            ? accountNonceQuery.result.possibleNextNonce
            : 0;

          const extra_metadata: any = {};

          if (subAccountIdentifier !== undefined) {
            switch (subAccountIdentifier.address) {
              case RosettaConstants.StackedBalance:
                balance = locked;
                break;
              case RosettaConstants.SpendableBalance:
                // Spendable balance is the standard raw balance minus the locked balance
                break;
              case RosettaConstants.VestingLockedBalance:
              case RosettaConstants.VestingUnlockedBalance:
                const stxVesting = await db.getTokenOfferingLocked(
                  accountIdentifier.address,
                  block.block_height
                );
                if (stxVesting.found) {
                  const vestingInfo = getVestingInfo(stxVesting.result);
                  extra_metadata[RosettaConstants.VestingSchedule] =
                    vestingInfo[RosettaConstants.VestingSchedule];
                } else {
                  balance = 0n;
                }
                break;
              default:
                throw RosettaErrors[RosettaErrorsTypes.invalidSubAccount];
            }
          }
          const balances: RosettaAmount[] = [
            {
              value: balance.toString(),
              currency: {
                symbol: RosettaConstants.symbol,
                decimals: RosettaConstants.decimals,
              },
              metadata: Object.keys(extra_metadata).length > 0 ? extra_metadata : undefined,
            },
          ];

          // Add Fungible Token balances.
          const ftBalances = await db.getFungibleTokenBalances({
            stxAddress: accountIdentifier.address,
            untilBlock: block.block_height,
          });
          const metadataClient = new RosettaFtMetadataClient(chainId);
          for (const [ftAssetIdentifier, ftBalance] of ftBalances) {
            const ftMetadata = await metadataClient.getFtMetadata(ftAssetIdentifier);
            if (ftMetadata) {
              balances.push({
                value: ftBalance.balance.toString(),
                currency: {
                  symbol: ftMetadata.symbol,
                  decimals: ftMetadata.decimals,
                },
              });
            }
          }

          const response: RosettaAccountBalanceResponse = {
            block_identifier: {
              index: block.block_height,
              hash: block.block_hash,
            },
            balances: balances,
            metadata: {
              sequence_number: sequenceNumber,
            },
          };
          return response;
        })
        .catch(error => {
          res.status(400).json(error);
        })
        .then(response => {
          res.json(response);
        });
    })
  );

  return router;
}

function getVestingInfo(info: AddressTokenOfferingLocked) {
  const jsonVestingSchedule: string[] = [];
  info.unlock_schedule.forEach(schedule => {
    const item = { amount: schedule.amount, unlock_height: schedule.block_height };
    jsonVestingSchedule.push(JSON.stringify(item));
  });
  return {
    [RosettaConstants.VestingLockedBalance]: info.total_locked,
    [RosettaConstants.VestingUnlockedBalance]: info.total_unlocked,
    [RosettaConstants.VestingSchedule]: jsonVestingSchedule,
  };
}
