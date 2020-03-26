import * as express from 'express';
import { addAsync } from '@awaitjs/express';

const router = addAsync(express.Router());

router.postAsync('/', (req, res) => {
  return res.json({ results: [] });
});

export const transactionRouter = router;
