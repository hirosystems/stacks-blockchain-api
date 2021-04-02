import * as express from 'express';
import { RouterWithAsync, addAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

const SUPPORTED_BLOCKCHAINS = ['stacks'];

export function createBnsAddressesRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.getAsync('/:blockchain/:address', async (req, res) => {
    // Retrieves a list of names owned by the address provided.
    const { blockchain, address } = req.params;
    if (!SUPPORTED_BLOCKCHAINS.includes(blockchain)) {
      res.status(404).json({ error: 'Unsupported blockchain' });
      return;
    }
    const namesByAddress = await db.getNamesByAddressList({
      blockchain: blockchain,
      address: address,
    });
    if (namesByAddress.found) {
      res.json({ names: namesByAddress.result });
    } else {
      res.json([]);
    }
  });

  return router;
}
