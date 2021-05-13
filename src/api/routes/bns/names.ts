import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';
import { parsePagingQueryInput } from '../../../api/pagination';
import { bnsBlockchain, BnsErrors } from '../../../bns-constants';
import { BnsGetNameInfoResponse } from '@stacks/stacks-blockchain-api-types';

export function createBnsNamesRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/:name/zonefile/:zoneFileHash', async (req, res) => {
    // Fetches the historical zonefile specified by the username and zone hash.
    const { name, zoneFileHash } = req.params;

    let nameFound = false;
    const nameQuery = await db.getName({ name: name });
    nameFound = nameQuery.found;
    if (!nameFound) {
      const subdomainQuery = await db.getSubdomain({ subdomain: name });
      nameFound = subdomainQuery.found;
    }

    if (nameFound) {
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

    let nameFound = false;
    const nameQuery = await db.getName({ name: name });
    nameFound = nameQuery.found;
    if (!nameFound) {
      const subdomainQuery = await db.getSubdomain({ subdomain: name });
      nameFound = subdomainQuery.found;
    }

    if (nameFound) {
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
      res.status(400).json(BnsErrors.InvalidPageNumber);
    }
    res.json(results);
  });

  router.getAsync('/:name', async (req, res, next) => {
    const { name } = req.params;
    let nameInfoResponse: BnsGetNameInfoResponse;
    // Subdomain case

    if (name.split('.').length == 3) {
      const subdomainQuery = await db.getSubdomain({ subdomain: name });
      if (!subdomainQuery.found) {
        const namePart = name.split('.').slice(1).join('.');
        const resolverResult = await db.getSubdomainResolver({ name: namePart });
        if (resolverResult.found) {
          if (resolverResult.result === '') {
            return res.status(404).json({ error: `missing resolver from a malformed zonefile` });
          }
          res.redirect(`${resolverResult.result}/v1/names${req.url}`);
          next();
          return;
        }
        return res.status(404).json({ error: `cannot find subdomain ${name}` });
      }
      const { result } = subdomainQuery;

      nameInfoResponse = {
        address: result.owner,
        blockchain: bnsBlockchain,
        last_txid: result.tx_id ? result.tx_id : '',
        resolver: result.resolver,
        status: 'registered_subdomain',
        zonefile: result.zonefile,
        zonefile_hash: result.zonefile_hash,
      };
    } else {
      const nameQuery = await db.getName({ name });
      if (!nameQuery.found) {
        return res.status(404).json({ error: `cannot find name ${name}` });
      }
      const { result } = nameQuery;
      nameInfoResponse = {
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
    }

    const response = Object.fromEntries(
      Object.entries(nameInfoResponse).filter(([_, v]) => v != null)
    );
    res.json(response);
  });

  return router;
}
