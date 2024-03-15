import * as express from 'express';
import { handleBadRequest } from '../../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import {
  CompiledPoxCyclePaginationQueryParams,
  PoxCyclePaginationQueryParams,
  validRequestQuery,
} from './schemas';
import { PoXCycleListResponse } from 'docs/generated';

export function createPoxRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  // router.get(
  //   '/',
  //   cacheHandler,
  //   asyncHandler(async (req, res) => {
  //     const limit = getPagingQueryLimit(ResourceType.Signer, req.query.limit);
  //     const offset = parsePagingQueryInput(req.query.offset ?? 0);
  //     // TODO: return signers for the latest cycle
  //     await Promise.resolve();
  //     setETagCacheHeaders(res);
  //     const response = {};
  //     res.json(response);
  //   })
  // );
  /*
    /extended/v2/pox/cycles
    /extended/v2/pox/cycles/:number
    /extended/v2/pox/cycles/next
    /extended/v2/pox/cycles/:number/signers
    /extended/v2/pox/cycles/:number/signers/:key/stackers
    /extended/v2/pox/cycles/:number/signers/:key/stackers/:address/delegates     *pools only

    /extended/v2/pox/signers/:key
    /extended/v2/pox/stackers/:address
    */
  router.get(
    '/cycles',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (!validRequestQuery(req, res, CompiledPoxCyclePaginationQueryParams)) return;
      const query = req.query as PoxCyclePaginationQueryParams;

      const cycles = await db.v2.getPoxCycles(query);
      setETagCacheHeaders(res);
      const response: PoXCycleListResponse = {
        limit: cycles.limit,
        offset: cycles.offset,
        total: cycles.total,
        results: cycles.results.map(c => ({
          block_height: c.block_height,
          index_block_hash: c.index_block_hash,
          cycle_number: c.cycle_number,
          total_weight: c.total_weight,
          total_stacked_amount: c.total_stacked_amount,
          total_signers: c.total_signers,
        })),
      };
      res.json(response);
    })
  );

  router.get(
    '/cycles/:number',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const cycleParam = req.params.number;
      const cycleNumber = parseInt(cycleParam);
      if (
        !Number.isInteger(cycleNumber) ||
        cycleNumber <= 0 ||
        cycleParam !== cycleNumber.toString()
      ) {
        handleBadRequest(res, next, 'The provided cycle number must be a positive integer');
      }
      const setResult = await db.getPoxSetForCycle(cycleNumber);
      setETagCacheHeaders(res);

      if (!setResult.found) {
        res.status(404).json({ error: `cannot find cycle ${cycleNumber}` });
        return;
      }
      const r = setResult.result;
      const resp = {
        index_block_hash: r.index_block_hash,
        cycle_number: r.cycle_number,
        total_stacked: r.total_stacked.toString(),
        total_weight: r.total_weight,
        signer_count: r.signer_count,
        signers: r.signers.map(s => ({
          signing_key: s.signing_key,
          weight: s.weight,
          weight_percent: s.weight_percent,
          stacked_amount: s.stacked_amount.toString(),
          stacked_amount_percent: s.stacked_amount_percent,
          stackers: s.stackers.map(st => ({
            stacker: st.stacker,
            amount: st.amount.toString(),
            pox_addr: st.pox_addr,
          })),
        })),
      };
      res.json(resp);
    })
  );

  return router;
}
