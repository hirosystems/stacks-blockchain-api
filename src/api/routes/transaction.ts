import * as express from 'express';
import { stx } from '@blockstack/stacks-transactions';

const router = express.Router();

router.post('/', (req, res) => {
  return res.json({ results: [] });
});

export const transactionRouter = router;
