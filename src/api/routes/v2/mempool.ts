import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import {
  ETagType,
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../controllers/cache-controller';
import { PgStore } from '../../../datastore/pg-store';
import { DbMempoolFeePriority, DbTxTypeId } from '../../../datastore/common';
import { MempoolFeePriorities } from '../../../../docs/generated';

function parseMempoolFeePriority(fees: DbMempoolFeePriority[]): MempoolFeePriorities {
  const out: MempoolFeePriorities = {
    all: { no_priority: 0, low_priority: 0, medium_priority: 0, high_priority: 0 },
  };
  for (const fee of fees) {
    const value = {
      no_priority: fee.no_priority,
      low_priority: fee.low_priority,
      medium_priority: fee.medium_priority,
      high_priority: fee.high_priority,
    };
    if (fee.type_id == null) out.all = value;
    else
      switch (fee.type_id) {
        case DbTxTypeId.TokenTransfer:
          out.token_transfer = value;
          break;
        case DbTxTypeId.ContractCall:
          out.contract_call = value;
          break;
        case DbTxTypeId.SmartContract:
        case DbTxTypeId.VersionedSmartContract:
          out.smart_contract = value;
          break;
      }
  }
  return out;
}

export function createMempoolRouter(db: PgStore): express.Router {
  const router = express.Router();
  const mempoolCacheHandler = getETagCacheHandler(db, ETagType.mempool);

  router.get(
    '/fees',
    mempoolCacheHandler,
    asyncHandler(async (req, res, next) => {
      setETagCacheHeaders(res);
      res.status(200).json(parseMempoolFeePriority(await db.getMempoolFeePriority()));
    })
  );

  return router;
}
