import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DbBlock } from '../../../datastore/common';
import { PgStore } from '../../../datastore/pg-store';
import { has0xPrefix, FoundOrNot, ChainID } from '../../../helpers';
import {
  RosettaAccount,
  RosettaBlockIdentifier,
  RosettaAccountBalanceResponse,
  RosettaSubAccount,
  AddressTokenOfferingLocked,
  RosettaAmount,
} from '@stacks/stacks-blockchain-api-types';
import { RosettaErrors, RosettaConstants, RosettaErrorsTypes } from '../../rosetta-constants';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { getValidatedFtMetadata } from '../../../rosetta-helpers';
import { isFtMetadataEnabled } from '../../../token-metadata/helpers';

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
            throw RosettaErrors[RosettaErrorsTypes.invalidBlockIdentifier];
          }

          if (!blockQuery.found) {
            throw RosettaErrors[RosettaErrorsTypes.blockNotFound];
          }

          const block = blockQuery.result;

          if (blockIdentifier?.hash !== undefined && block.block_hash !== blockIdentifier.hash) {
            throw RosettaErrors[RosettaErrorsTypes.invalidBlockHash];
          }

          const stxBalance = await db.getStxBalanceAtBlock(
            accountIdentifier.address,
            block.block_height
          );
          // return spendable balance (liquid) if no sub-account is specified
          let balance = (stxBalance.balance - stxBalance.locked).toString();

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
                throw RosettaErrors[RosettaErrorsTypes.invalidSubAccount];
            }
          }
          const balances: RosettaAmount[] = [
            {
              value: balance,
              currency: {
                symbol: RosettaConstants.symbol,
                decimals: RosettaConstants.decimals,
              },
              metadata: Object.keys(extra_metadata).length > 0 ? extra_metadata : undefined,
            },
          ];

          // Add Fungible Token balances.
          if (isFtMetadataEnabled()) {
            const ftBalances = await db.getFungibleTokenBalances({
              stxAddress: accountIdentifier.address,
              untilBlock: block.block_height,
            });
            for (const [ftAssetIdentifier, ftBalance] of ftBalances) {
              const ftMetadata = await getValidatedFtMetadata(db, ftAssetIdentifier);
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
