import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { isValidPrincipal } from '../../helpers';

export function createSearchRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.getAsync('/:term', async (req, res) => {
    const { term: rawTerm } = req.params;
    const term = rawTerm.trim();

    // Check if term is a 32-byte hash, e.g.:
    //   `0x4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    //   `4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    let hashBuffer: Buffer | undefined;
    if (term.length === 66 && term.toLowerCase().startsWith('0x')) {
      hashBuffer = Buffer.from(term.slice(2), 'hex');
    } else if (term.length === 64) {
      hashBuffer = Buffer.from(term, 'hex');
    }
    if (hashBuffer !== undefined && hashBuffer.length === 32) {
      const hash = '0x' + hashBuffer.toString('hex');
      const hashQueryResult = await db.searchHash({ hash });
      if (hashQueryResult.found) {
        res.json(hashQueryResult);
        return;
      }
    }

    // Check if term is an account or contract principal address, e.g.:
    //   `ST3DQ94YDRH07GRKTCNN5FTW962ACVADVJZD7GSK3`
    //   `ST2TJRHDHMYBQ417HFB0BDX430TQA5PXRX6495G1V.contract-name`
    if (isValidPrincipal(term)) {
      const principalQueryResult = await db.searchPrincipal({ principal: term });
      if (principalQueryResult.found) {
        res.json(principalQueryResult);
        return;
      }
    }

    res.status(404).json({ found: false, error: `cannot find entity by "${term}"` });
  });

  return router;
}
