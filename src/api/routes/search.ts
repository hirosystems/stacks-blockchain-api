import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { isValidPrincipal, has0xPrefix } from '../../helpers';

type SearchResult =
  | {
      found: false;
      result: {
        entity_type: 'standard_address' | 'contract_address' | 'unknown_hash' | 'invalid_term';
      };
      error: string;
    }
  | {
      found: true;
      result: {
        entity_type:
          | 'standard_address'
          | 'contract_address'
          | 'block_hash'
          | 'tx_id'
          | 'mempool_tx_id';
        entity_id: string;
      };
    };

export function createSearchRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  const performSearch = async (term: string): Promise<SearchResult> => {
    // Check if term is a 32-byte hash, e.g.:
    //   `0x4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    //   `4ac9b89ec7f2a0ca3b4399888904f171d7bdf3460b1c63ea86c28a83c2feaad8`
    let hashBuffer: Buffer | undefined;
    if (term.length === 66 && has0xPrefix(term)) {
      hashBuffer = Buffer.from(term.slice(2), 'hex');
    } else if (term.length === 64) {
      hashBuffer = Buffer.from(term, 'hex');
    }
    if (hashBuffer !== undefined && hashBuffer.length === 32) {
      const hash = '0x' + hashBuffer.toString('hex');
      const hashQueryResult = await db.searchHash({ hash });
      if (hashQueryResult.found) {
        return hashQueryResult;
      } else {
        return {
          found: false,
          result: { entity_type: 'unknown_hash' },
          error: `No block or transaction found with hash "${hash}"`,
        };
      }
    }

    // Check if term is an account or contract principal address, e.g.:
    //   `ST3DQ94YDRH07GRKTCNN5FTW962ACVADVJZD7GSK3`
    //   `ST2TJRHDHMYBQ417HFB0BDX430TQA5PXRX6495G1V.contract-name`
    const principalCheck = isValidPrincipal(term);
    if (principalCheck) {
      const principalQueryResult = await db.searchPrincipal({ principal: term });
      if (principalQueryResult.found) {
        return principalQueryResult;
      } else {
        return {
          found: false,
          result: {
            entity_type:
              principalCheck.type === 'contractAddress' ? 'contract_address' : 'standard_address',
          },
          error: `No principal found with address "${term}"`,
        };
      }
    }

    return {
      found: false,
      result: {
        entity_type: 'invalid_term',
      },
      error: `The term "${term}" is not a valid block hash, transaction ID, contract principal, or account address principal`,
    };
  };

  router.getAsync('/:term', async (req, res) => {
    const { term: rawTerm } = req.params;
    const term = rawTerm.trim();

    const searchResult = await performSearch(term);
    if (!searchResult.found) {
      res.status(404);
    }
    res.json(searchResult);
  });

  return router;
}
