import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import BigNumber from 'bignumber.js';
import { DataStore } from '../../datastore/common';
import { microStxToStx, STACKS_DECIMAL_PLACES, TOTAL_STACKS } from '../../helpers';
import {
  GetTotalStxSupplyLegacyFormatResponse,
  GetTotalStxSupplyResponse,
} from '@blockstack/stacks-blockchain-api-types';

export function createTotalSupplyRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  async function getStxSupplyInfo(
    atBlockHeight?: number
  ): Promise<{
    unlockedPercent: string;
    totalStx: string;
    unlockedStx: string;
    blockHeight: number;
  }> {
    const { stx: unlockedSupply, blockHeight } = await db.getUnlockedStxSupply({
      blockHeight: atBlockHeight,
    });
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

  router.getAsync('/', async (req, res) => {
    let atBlockHeight: number | undefined;
    if ('height' in req.query) {
      atBlockHeight = parseInt(req.query['height'] as string, 10);
      if (!Number.isInteger(atBlockHeight)) {
        return res
          .status(400)
          .json({ error: `height is not a valid integer: ${req.query['height']}` });
      }
      if (atBlockHeight < 1) {
        return res
          .status(400)
          .json({ error: `height is not a positive integer: ${atBlockHeight}` });
      }
    }
    const supply = await getStxSupplyInfo(atBlockHeight);
    const result: GetTotalStxSupplyResponse = {
      unlocked_percent: supply.unlockedPercent,
      total_stx: supply.totalStx,
      unlocked_stx: supply.unlockedStx,
      block_height: supply.blockHeight,
    };
    res.json(result);
  });

  router.getAsync('/legacy_format', async (req, res) => {
    let atBlockHeight: number | undefined;
    if ('height' in req.query) {
      atBlockHeight = parseInt(req.query['height'] as string, 10);
      if (!Number.isInteger(atBlockHeight)) {
        return res
          .status(400)
          .json({ error: `height is not a valid integer: ${req.query['height']}` });
      }
      if (atBlockHeight < 1) {
        return res
          .status(400)
          .json({ error: `height is not a positive integer: ${atBlockHeight}` });
      }
    }

    const supply = await getStxSupplyInfo(atBlockHeight);
    const result: GetTotalStxSupplyLegacyFormatResponse = {
      unlockedPercent: supply.unlockedPercent,
      totalStacks: supply.totalStx,
      totalStacksFormatted: new BigNumber(supply.totalStx).toFormat(STACKS_DECIMAL_PLACES, 8),
      unlockedSupply: supply.unlockedStx,
      unlockedSupplyFormatted: new BigNumber(supply.unlockedStx).toFormat(STACKS_DECIMAL_PLACES, 8),
      blockHeight: supply.blockHeight.toString(),
    };
    res.json(result);
  });

  return router;
}
