import * as express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  return res.json({ results: [] });
});

export const transactionRouter = router;
