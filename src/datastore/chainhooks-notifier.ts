import Redis from 'ioredis';
import { ReOrgUpdatedEntities } from './common';
import { ChainID } from '@stacks/transactions';
import { getApiConfiguredChainID } from '../helpers';
import { logger } from '@hirosystems/api-toolkit';

/**
 * Notifies Chainhooks of the progress of the Stacks index.
 */
export class ChainhooksNotifier {
  private readonly redis: Redis;
  private readonly chainId: ChainID;
  private readonly queue: string;

  constructor() {
    const url = process.env.CHAINHOOKS_REDIS_URL;
    if (!url) throw new Error(`ChainhooksNotifier CHAINHOOKS_REDIS_URL is not set`);
    this.queue = process.env.CHAINHOOKS_REDIS_QUEUE || 'chainhooks:index-progress';
    this.redis = new Redis(url);
    this.chainId = getApiConfiguredChainID();
    logger.info(`ChainhooksNotifier initialized for queue ${this.queue} on ${url}`);
  }

  /**
   * Broadcast index progress message to Chainhooks Redis queue.
   * @param reOrg - The re-org updated entities
   * @param indexBlockHash - The index block hash that we will restore first
   * @param blockHeight - The block height that we will restore first
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
    logger.info(message, 'ChainhooksNotifier broadcasting index progress message');
    await this.redis.rpush(this.queue, JSON.stringify(message));
  }

  async close() {
    await this.redis.quit();
  }
}
