import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

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

  return router;
}
