import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore, DbBlock } from '../../../datastore/common';
import { has0xPrefix, FoundOrNot } from '../../../helpers';
import {
  NetworkIdentifier,
  RosettaAccount,
  RosettaBlockIdentifier,
  RosettaAccountBalanceResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { RosettaErrors, RosettaConstants } from '../../rosetta-constants';
import { rosettaValidateRequest, ValidSchema, makeRosettaError } from '../../rosetta-validate';
import { ChainID } from '@stacks/transactions';

export function createRosettaAccountRouter(db: DataStore, chainId: ChainID): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/balance', async (req, res) => {
    const valid: ValidSchema = await rosettaValidateRequest(req.originalUrl, req.body, chainId);
    if (!valid.valid) {
      res.status(400).json(makeRosettaError(valid));
      return;
    }

    const accountIdentifier: RosettaAccount = req.body.account_identifier;
    const blockIdentifier: RosettaBlockIdentifier = req.body.block_identifier;
    let blockQuery: FoundOrNot<DbBlock>;

    // we need to return the block height/hash in the response, so we
    // need to fetch the block first.
    if (blockIdentifier === undefined) {
      blockQuery = await db.getCurrentBlock();
    } else if (blockIdentifier.index >= 0) {
      blockQuery = await db.getBlockByHeight(blockIdentifier.index);
    } else if (blockIdentifier.hash !== undefined) {
      let blockHash = blockIdentifier.hash;
      if (!has0xPrefix(blockHash)) {
        blockHash = '0x' + blockHash;
      }
      blockQuery = await db.getBlock(blockHash);
    } else {
      return res.status(400).json(RosettaErrors.invalidBlockIdentifier);
    }

    if (!blockQuery.found) {
      return res.status(400).json(RosettaErrors.blockNotFound);
    }

    const block = blockQuery.result;
    const result = await db.getStxBalanceAtBlock(accountIdentifier.address, block.block_height);

    const response: RosettaAccountBalanceResponse = {
      block_identifier: {
        index: block.block_height,
        hash: block.block_hash,
      },
      balances: [
        {
          value: result.balance.toString(),
          currency: {
            symbol: RosettaConstants.symbol,
            decimals: RosettaConstants.decimals,
          },
        },
      ],
      coins: [],
      metadata: {
        sequence_number: 0,
      },
    };

    res.json(response);
  });

  return router;
}
