import * as express from 'express';
import { asyncHandler } from '../async-handler';
import {
  BurnchainReward,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolder,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';

import { isValidBitcoinAddress, tryConvertC32ToBtc } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { PgStore } from '../../datastore/pg-store';

export function createBurnchainRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/reward_slot_holders',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const queryResults = await db.getBurnchainRewardSlotHolders({ offset, limit });
      const results = queryResults.slotHolders.map(r => {
        const slotHolder: BurnchainRewardSlotHolder = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          address: r.address,
          slot_index: r.slot_index,
        };
        return slotHolder;
      });
      const response: BurnchainRewardSlotHolderListResponse = {
        limit,
        offset,
        total: queryResults.total,
        results: results,
      };
      res.json(response);
    })
  );

  router.get(
    '/reward_slot_holders/:address',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address ${queryAddr} is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await db.getBurnchainRewardSlotHolders({
        offset,
        limit,
        burnchainAddress,
      });
      const results = queryResults.slotHolders.map(r => {
        const slotHolder: BurnchainRewardSlotHolder = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          address: r.address,
          slot_index: r.slot_index,
        };
        return slotHolder;
      });
      const response: BurnchainRewardSlotHolderListResponse = {
        limit,
        offset,
        total: queryResults.total,
        results: results,
      };
      res.json(response);
    })
  );

  router.get(
    '/rewards',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const queryResults = await db.getBurnchainRewards({ offset, limit });
      const results = queryResults.map(r => {
        const reward: BurnchainReward = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          burn_amount: r.burn_amount.toString(),
          reward_recipient: r.reward_recipient,
          reward_amount: r.reward_amount.toString(),
          reward_index: r.reward_index,
        };
        return reward;
      });
      const response: BurnchainRewardListResponse = { limit, offset, results };
      // TODO: schema validation
      res.json(response);
    })
  );

  router.get(
    '/rewards/:address',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Burnchain, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address ${queryAddr} is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await db.getBurnchainRewards({
        burnchainRecipient: burnchainAddress,
        offset,
        limit,
      });
      const results = queryResults.map(r => {
        const reward: BurnchainReward = {
          canonical: r.canonical,
          burn_block_hash: r.burn_block_hash,
          burn_block_height: r.burn_block_height,
          burn_amount: r.burn_amount.toString(),
          reward_recipient: r.reward_recipient,
          reward_amount: r.reward_amount.toString(),
          reward_index: r.reward_index,
        };
        return reward;
      });
      const response: BurnchainRewardListResponse = { limit, offset, results };
      // TODO: schema validation
      res.json(response);
    })
  );

  router.get(
    '/rewards/:address/total',
    asyncHandler(async (req, res) => {
      const { address } = req.params;

      let burnchainAddress: string | undefined = undefined;
      const queryAddr = address.trim();
      if (isValidBitcoinAddress(queryAddr)) {
        burnchainAddress = queryAddr;
      } else {
        const convertedAddr = tryConvertC32ToBtc(queryAddr);
        if (convertedAddr) {
          burnchainAddress = convertedAddr;
        }
      }
      if (!burnchainAddress) {
        throw new InvalidRequestError(
          `Address ${queryAddr} is not a valid Bitcoin or STX address.`,
          InvalidRequestErrorType.invalid_address
        );
      }

      const queryResults = await db.getBurnchainRewardsTotal(burnchainAddress);
      const response: BurnchainRewardsTotal = {
        reward_recipient: queryResults.reward_recipient,
        reward_amount: queryResults.reward_amount.toString(),
      };
      // TODO: schema validation
      res.json(response);
    })
  );

  return router;
}
