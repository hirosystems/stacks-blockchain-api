import * as duckdb from 'duckdb';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { DbBurnchainReward, DbRewardSlotHolder } from '../../../datastore/common';
import { CoreNodeBurnBlockMessage } from '../../../event-stream/core-node-message';
import { logger } from '../../../logger';

const INSERT_BATCH_SIZE = 500;

const parsePayload = (payload: CoreNodeBurnBlockMessage) => {
  const rewards = payload.reward_recipients.map((r, index) => {
    const dbReward: DbBurnchainReward = {
      canonical: true,
      burn_block_hash: payload.burn_block_hash,
      burn_block_height: payload.burn_block_height,
      burn_amount: BigInt(payload.burn_amount),
      reward_recipient: r.recipient,
      reward_amount: BigInt(r.amt),
      reward_index: index,
    };
    return dbReward;
  });

  const slotHolders = payload.reward_slot_holders.map((r, index) => {
    const slotHolder: DbRewardSlotHolder = {
      canonical: true,
      burn_block_hash: payload.burn_block_hash,
      burn_block_height: payload.burn_block_height,
      address: r,
      slot_index: index,
    };
    return slotHolder;
  });

  return { rewards, slotHolders };
}

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

const fromCanonicalDataset = (process: any) => {
  var inMemoryDB = new duckdb.Database(':memory:');
  inMemoryDB.all(
    "SELECT * FROM READ_PARQUET('events/new_burn_block/canonical/*.parquet')",
    (err: any, res: any) => {
      if (err) {
        throw err;
      }
      process(res);
    });
}

const fromDatasetAndInsert = async (db: PgWriteStore) => {
  fromCanonicalDataset((events: any) => {
    [...chunks(events, INSERT_BATCH_SIZE)].forEach(async (chunk: any) => {
      let burnchainRewards: DbBurnchainReward[] = [];
      let slotHolders: DbRewardSlotHolder[] = [];
      chunk.forEach((ev: any) => {
        const payload: CoreNodeBurnBlockMessage = JSON.parse(ev['payload']);
        const burnBlockData = parsePayload(payload);
        burnBlockData.rewards.forEach(reward => burnchainRewards.push(reward));
        burnBlockData.slotHolders.forEach(holder => slotHolders.push(holder));
      });

      if (burnchainRewards.length !== 0 && slotHolders.length !== 0) {
        await db.insertBurnchainRewardsAndSlotHoldersBatch(burnchainRewards, slotHolders);
      }
    });
  });
}

const insertNewBurnBlockEvents = (db: PgWriteStore) => {
  return new Promise((resolve) => {
    logger.info(`Inserting NEW_BURN_BLOCK events to db...`);
    fromDatasetAndInsert(db);
  });
};

export { insertNewBurnBlockEvents };
