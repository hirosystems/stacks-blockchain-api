import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';

export function createContractRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.getAsync('/:contract_id', async (req, res) => {
    const { contract_id } = req.params;
    const contractQuery = await db.getSmartContract(contract_id);
    if (!contractQuery.found) {
      res.status(404).json({ error: `cannot find contract by ID ${contract_id}` });
      return;
    }
    res.json(contractQuery.result);
  });

  return router;
}
