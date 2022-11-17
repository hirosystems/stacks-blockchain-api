import * as express from 'express';
import { BlockListResponse } from '@stacks/stacks-blockchain-api-types';
import { getBlockFromDataStore, getBlocksWithMetadata } from '../../controllers/db-controller';
import { has0xPrefix } from '../../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../../pagination';
import { getBlockHeightPathParam, validateRequestHexInput } from '../../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import { getAddressInfo } from './utils';
import { BLOCKCHAIN_INFO_API_ENDPOINT, STACKS_API_ENDPOINT } from './consts';
import fetch, { RequestInit } from 'node-fetch';
import BigNumber from 'bignumber.js';

export function createBtcRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get('/addr/:address', cacheHandler, (req, res) => {
    const addrInfo = getAddressInfo(req.params.address, req.query.network);
    res.json(addrInfo);
  });

  router.get(
    '/addr/:address/balances',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const addrInfo = getAddressInfo(req.params.address, 'mainnet');

      const stxBalanceReq = await fetch(
        `${STACKS_API_ENDPOINT}/extended/v1/address/${addrInfo.stacks}/balances`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      ); // get api instance
      // const stxBalance = await stxBalanceReq.body.json(); // TODO: Test this change
      const stxBalance = await stxBalanceReq.json();
      const stxBalanceFormatted = new BigNumber(stxBalance.stx.balance).shiftedBy(-6).toFixed(6);
      const btcBalanceReq = await fetch(
        `${BLOCKCHAIN_INFO_API_ENDPOINT}/rawaddr/${addrInfo.bitcoin}?limit=0`
      );
      // const btcBalance = await btcBalanceReq.body.json(); // TODO: Test this change
      const btcBalance = await btcBalanceReq.json();
      const btcBalanceFormatted = new BigNumber(btcBalance.final_balance).shiftedBy(-8).toFixed(8);

      res.json({
        stacks: {
          address: addrInfo.stacks,
          balance: stxBalanceFormatted,
        },
        bitcoin: {
          address: addrInfo.bitcoin,
          balance: btcBalanceFormatted,
        },
      });
    })
  );

  router.get(
    '/by_burn_block_height/:burnBlockHeight',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const burnBlockHeight = parseInt(req.params['burnBlockHeight'], 10);
      if (!Number.isInteger(burnBlockHeight)) {
        throw new InvalidRequestError(
          `burnchain height is not a valid integer: ${req.params['burnBlockHeight']}`,
          InvalidRequestErrorType.invalid_param
        );
      }
      if (burnBlockHeight < 1) {
        throw new InvalidRequestError(
          `burnchain height is not a positive integer: ${burnBlockHeight}`,
          InvalidRequestErrorType.invalid_param
        );
      }
      const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHeight }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by height ${burnBlockHeight}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  router.get(
    '/:hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { hash } = req.params;

      if (!has0xPrefix(hash)) {
        return res.redirect('/extended/v1/block/0x' + hash);
      }
      validateRequestHexInput(hash);

      const block = await getBlockFromDataStore({ blockIdentifer: { hash }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by hash ${hash}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  router.get(
    '/by_burn_block_hash/:burnBlockHash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { burnBlockHash } = req.params;

      if (!has0xPrefix(burnBlockHash)) {
        return res.redirect('/extended/v1/block/by_burn_block_hash/0x' + burnBlockHash);
      }

      const block = await getBlockFromDataStore({ blockIdentifer: { burnBlockHash }, db });
      if (!block.found) {
        res.status(404).json({ error: `cannot find block by burn block hash ${burnBlockHash}` });
        return;
      }
      setETagCacheHeaders(res);
      // TODO: block schema validation
      res.json(block.result);
    })
  );

  return router;
}
