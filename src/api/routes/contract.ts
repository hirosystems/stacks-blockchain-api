import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as cors from 'cors';
import { DataStore } from '../../datastore/common';

export function createContractRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(cors());

  router.getAsync('/:contract_id', async (req, res) => {
    const { contract_id } = req.params;
    const contract = await db.getSmartContract(contract_id);
    res.json(contract);
  });

  return router;
}
