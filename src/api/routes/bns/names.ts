import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DataStore } from '../../../datastore/common';
import { parsePagingQueryInput } from '../../../api/pagination';
import { isUnanchoredRequest } from '../../query-helpers';
import { bnsBlockchain, BnsErrors } from '../../../bns-constants';
import { BnsGetNameInfoResponse } from '@stacks/stacks-blockchain-api-types';

export function createBnsNamesRouter(db: DataStore): express.Router {
  const router = express.Router();

  router.get(
    '/:name/zonefile/:zoneFileHash',
    asyncHandler(async (req, res, next) => {
      // Fetches the historical zonefile specified by the username and zone hash.
      const { name, zoneFileHash } = req.params;
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      let nameFound = false;
      const nameQuery = await db.getName({ name: name, includeUnanchored });
      nameFound = nameQuery.found;
      if (!nameFound) {
        const subdomainQuery = await db.getSubdomain({ subdomain: name, includeUnanchored });
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
    })
  );

  router.get(
    '/:name/zonefile',
    asyncHandler(async (req, res, next) => {
      // Fetch a user’s raw zone file. This only works for RFC-compliant zone files. This method returns an error for names that have non-standard zone files.
      const { name } = req.params;
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      let nameFound = false;
      const nameQuery = await db.getName({ name: name, includeUnanchored });
      nameFound = nameQuery.found;
      if (!nameFound) {
        const subdomainQuery = await db.getSubdomain({ subdomain: name, includeUnanchored });
        nameFound = subdomainQuery.found;
      }

      if (nameFound) {
        const zonefile = await db.getLatestZoneFile({ name: name, includeUnanchored });
        if (zonefile.found) {
          res.json(zonefile.result);
        } else {
          res.status(404).json({ error: 'No zone file for name' });
        }
      } else {
        res.status(400).json({ error: 'Invalid name or subdomain' });
      }
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res, next) => {
      const page = parsePagingQueryInput(req.query.page ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results } = await db.getNamesList({ page, includeUnanchored });
      if (results.length === 0 && req.query.page) {
        res.status(400).json(BnsErrors.InvalidPageNumber);
      }
      res.json(results);
    })
  );

  router.get(
    '/:name',
    asyncHandler(async (req, res, next) => {
      const { name } = req.params;
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      let nameInfoResponse: BnsGetNameInfoResponse;
      // Subdomain case
      if (name.split('.').length == 3) {
        const subdomainQuery = await db.getSubdomain({ subdomain: name, includeUnanchored });
        if (!subdomainQuery.found) {
          const namePart = name.split('.').slice(1).join('.');
          const resolverResult = await db.getSubdomainResolver({ name: namePart });
          if (resolverResult.found) {
            if (resolverResult.result === '') {
              res.status(404).json({ error: `missing resolver from a malformed zonefile` });
              return;
            }
            res.redirect(`${resolverResult.result}/v1/names${req.url}`);
            next();
            return;
          }
          res.status(404).json({ error: `cannot find subdomain ${name}` });
          return;
        }
        const { result } = subdomainQuery;

        nameInfoResponse = {
          address: result.owner,
          blockchain: bnsBlockchain,
          last_txid: result.tx_id,
          resolver: result.resolver,
          status: 'registered_subdomain',
          zonefile: result.zonefile,
          zonefile_hash: result.zonefile_hash,
        };
      } else {
        const nameQuery = await db.getName({ name, includeUnanchored: includeUnanchored });
        if (!nameQuery.found) {
          res.status(404).json({ error: `cannot find name ${name}` });
          return;
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
    })
  );

  return router;
}
