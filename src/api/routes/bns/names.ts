import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import { parsePagingQueryInput } from '../../../api/pagination';
import { bnsBlockchain, BNSErrors } from '../../../bns-constants';
import { BNSGetNameInfoResponse } from '@blockstack/stacks-blockchain-api-types';

export function createBNSNamesRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/:name/zonefile/:zoneFileHash', async (req, res) => {
    // Fetches the historical zonefile specified by the username and zone hash.
    const { name, zoneFileHash } = req.params;

    const nameQuery = await db.getName({ name: name });
    if (nameQuery.found) {
      const zonefile = await db.getHistoricalZoneFile({ name: name, zoneFileHash: zoneFileHash });
      if (zonefile.found) {
        res.json(zonefile.result);
      } else {
        res.status(404).json({ error: 'No such zonefile' });
      }
    } else {
      res.status(400).json({ error: 'Invalid name or subdomain' });
    }
  });

  router.getAsync('/:name/zonefile', async (req, res) => {
    // Fetch a user’s raw zone file. This only works for RFC-compliant zone files. This method returns an error for names that have non-standard zone files.
    const { name } = req.params;

    const nameQuery = await db.getName({ name: name });
    if (nameQuery.found) {
      const zonefile = await db.getLatestZoneFile({ name: name });
      if (zonefile.found) {
        res.json(zonefile.result);
      } else {
        res.status(404).json({ error: 'No zone file for name' });
      }
    } else {
      res.status(400).json({ error: 'Invalid name or subdomain' });
    }
  });

  router.getAsync('/', async (req, res) => {
    const page = parsePagingQueryInput(req.query.page ?? 0);

    const { results } = await db.getNamesList({ page });
    if (results.length === 0 && req.query.page) {
      res.status(400).json(BNSErrors.InvalidPageNumber);
    }
    res.json(results);
  });

  router.getAsync('/:name', async (req, res) => {
    const { name } = req.params;

    const nameQuery = await db.getName({ name });
    if (!nameQuery.found) {
      return res.status(404).json({ error: `cannot find name ${name}` });
    }

    const { result } = nameQuery;
    const nameInfo: BNSGetNameInfoResponse = {
      address: result.address,
      blockchain: bnsBlockchain,
      expire_block: result.expire_block,
      grace_period: result.grace_period,
      last_txid: result.tx_id ? result.tx_id : '',
      resolver: result.resolver,
      status: result.status ? result.status : '',
      zonefile: result.zonefile,
      zonefile_hash: result.zonefile_hash,
    };
    const response = Object.fromEntries(Object.entries(nameInfo).filter(([_, v]) => v != null));
    res.json(response);
  });

  return router;
}
