import * as express from 'express';
import { asyncHandler } from '../async-handler';
import BigNumber from 'bignumber.js';
import { microStxToStx, STACKS_DECIMAL_PLACES, TOTAL_STACKS } from '../../helpers';
import {
  GetStxCirculatingSupplyPlainResponse,
  GetStxSupplyLegacyFormatResponse,
  GetStxSupplyResponse,
  GetStxTotalSupplyPlainResponse,
} from '@stacks/stacks-blockchain-api-types';
import { getBlockParams } from '../query-helpers';
import { PgStore } from '../../datastore/pg-store';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';

export function createStxSupplyRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  async function getStxSupplyInfo(
    args:
      | {
          blockHeight: number;
        }
      | {
          includeUnanchored: boolean;
        }
  ): Promise<{
    unlockedPercent: string;
    totalStx: string;
    unlockedStx: string;
    blockHeight: number;
  }> {
    const { stx: unlockedSupply, blockHeight } = await db.getUnlockedStxSupply(args);
    const totalMicroStx = new BigNumber(TOTAL_STACKS).shiftedBy(STACKS_DECIMAL_PLACES);
    const unlockedPercent = new BigNumber(unlockedSupply.toString())
      .div(totalMicroStx)
      .times(100)
      .toFixed(2);
    return {
      unlockedPercent,
      totalStx: microStxToStx(totalMicroStx),
      unlockedStx: microStxToStx(unlockedSupply),
      blockHeight: blockHeight,
    };
  }

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const blockParams = getBlockParams(req, res, next);
      const supply = await getStxSupplyInfo(blockParams);
      const result: GetStxSupplyResponse = {
        unlocked_percent: supply.unlockedPercent,
        total_stx: supply.totalStx,
        unlocked_stx: supply.unlockedStx,
        block_height: supply.blockHeight,
      };
      setETagCacheHeaders(res);
      res.json(result);
    })
  );

  router.get(
    '/total/plain',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const supply = await getStxSupplyInfo({ includeUnanchored: false });
      const result: GetStxTotalSupplyPlainResponse = supply.totalStx;
      setETagCacheHeaders(res);
      res.type('text/plain').send(result);
    })
  );

  router.get(
    '/circulating/plain',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const supply = await getStxSupplyInfo({ includeUnanchored: false });
      const result: GetStxCirculatingSupplyPlainResponse = supply.unlockedStx;
      setETagCacheHeaders(res);
      res.type('text/plain').send(result);
    })
  );

  router.get(
    '/legacy_format',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const blockParams = getBlockParams(req, res, next);
      const supply = await getStxSupplyInfo(blockParams);
      const result: GetStxSupplyLegacyFormatResponse = {
        unlockedPercent: supply.unlockedPercent,
        totalStacks: supply.totalStx,
        totalStacksFormatted: new BigNumber(supply.totalStx).toFormat(STACKS_DECIMAL_PLACES, 8),
        unlockedSupply: supply.unlockedStx,
        unlockedSupplyFormatted: new BigNumber(supply.unlockedStx).toFormat(
          STACKS_DECIMAL_PLACES,
          8
        ),
        blockHeight: supply.blockHeight.toString(),
      };
      setETagCacheHeaders(res);
      res.json(result);
    })
  );

  return router;
}
