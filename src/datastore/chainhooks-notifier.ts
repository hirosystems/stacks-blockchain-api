import Redis from 'ioredis';
import { ReOrgUpdatedEntities } from './common';
import { ChainID } from '@stacks/transactions';
import { getApiConfiguredChainID } from '../helpers';
import { logger } from '@hirosystems/api-toolkit';

/**
 * Notifies Chainhooks of the progress of the Stacks index via a message sent to a Redis queue. This
 * message will contain a block header for each new canonical block as well as headers for those
 * that need to be rolled back from a re-org.
 */
export class ChainhooksNotifier {
  private readonly redis: Redis;
  private readonly chainId: ChainID;
  private readonly queue: string;

  constructor() {
    const url = process.env.CHAINHOOKS_REDIS_URL;
    if (!url) throw new Error(`ChainhooksNotifier is enabled but CHAINHOOKS_REDIS_URL is not set`);
    this.queue = process.env.CHAINHOOKS_REDIS_QUEUE ?? 'chainhooks:stacks:index-progress';
    this.redis = new Redis(url);
    this.chainId = getApiConfiguredChainID();
    logger.info(`ChainhooksNotifier initialized for queue ${this.queue} on ${url}`);
  }

  /**
   * Broadcast index progress message to Chainhooks Redis queue.
   * @param reOrg - The re-org updated entities, if any
   * @param indexBlockHash - Block hash of the newest canonical block
   * @param blockHeight - Block height of the newest canonical block
   */
  async notify(reOrg: ReOrgUpdatedEntities, indexBlockHash: string, blockHeight: number) {
    const message = {
      id: `stacks-${blockHeight}-${indexBlockHash}-${Date.now()}`,
      payload: {
        chain: 'stacks',
        network: this.chainId === ChainID.Mainnet ? 'mainnet' : 'testnet',
        apply_blocks: [
          ...reOrg.markedCanonical.blockHeaders.map(block => ({
            hash: block.index_block_hash,
            index: block.block_height,
          })),
          {
            hash: indexBlockHash,
            index: blockHeight,
          },
        ],
        rollback_blocks: reOrg.markedNonCanonical.blockHeaders.map(block => ({
          hash: block.index_block_hash,
          index: block.block_height,
        })),
      },
    };
    logger.debug(message, 'ChainhooksNotifier broadcasting index progress message');
    await this.redis.rpush(this.queue, JSON.stringify(message));
  }

  async close() {
    await this.redis.quit();
  }
}
