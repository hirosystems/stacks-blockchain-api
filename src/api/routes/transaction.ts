import * as express from 'express';
import { addAsync } from '@awaitjs/express';

const router = addAsync(express.Router() as express.Express);

router.postAsync('/', (req, res) => {
  return res.json({ results: [] });
});

export const transactionRouter = router;
