import { PgWriteStore } from '../../../datastore/pg-write-store';
import { DbBurnchainReward, DbRewardSlotHolder } from '../../../datastore/common';
import { CoreNodeBurnBlockMessage } from '../../../event-stream/core-node-message';
import { logger } from '../../../logger';
import { TimeTracker, splitIntoChunks } from '../helpers';
import { DatasetStore } from '../dataset/store';

const INSERT_BATCH_SIZE = 500;

const DbBurnchainRewardParse = (payload: CoreNodeBurnBlockMessage) => {
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

  return rewards;
};

const DbRewardSlotHolderParse = (payload: CoreNodeBurnBlockMessage) => {
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

  return slotHolders;
};

const insertBurnchainRewardsAndSlotHolders = async (db: PgWriteStore, chunks: any) => {
  for (const chunk of chunks) {
    let burnchainRewards: DbBurnchainReward[] = [];
    let slotHolders: DbRewardSlotHolder[] = [];
    for (const event of chunk) {
      const payload: CoreNodeBurnBlockMessage = JSON.parse(event['payload']);
      const burnchainRewardsData = DbBurnchainRewardParse(payload);
      const slotHoldersData = DbRewardSlotHolderParse(payload);
      burnchainRewardsData.forEach(reward => burnchainRewards.push(reward));
      slotHoldersData.forEach(slotHolder => slotHolders.push(slotHolder));
    };

    if (burnchainRewards.length !== 0) {
      await db.insertBurnchainRewardsBatch(db.sql, burnchainRewards);
    }

    if (slotHolders.length !== 0) {
      await db.insertSlotHoldersBatch(db.sql, slotHolders);
    }
  };
};

export const insertNewBurnBlockEvents = async (db: PgWriteStore, dataset: DatasetStore, timeTracker: TimeTracker) => {
  logger.info(`Inserting NEW_BURN_BLOCK events to db...`);

  await timeTracker.track('insertNewBurnBlockEvents', async () => {
    return dataset.newBurnBlockEventsOrdered()
      .then(async (data: any) => await splitIntoChunks(data, INSERT_BATCH_SIZE))
      .then(async (chunks: any) => await insertBurnchainRewardsAndSlotHolders(db, chunks));
  });
};
