import Redis, { Cluster, RedisOptions } from 'ioredis';
import { ReOrgUpdatedEntities } from './common';
import { ChainID } from '@stacks/transactions';
import { getApiConfiguredChainID } from '../helpers';
import { logger } from '@hirosystems/api-toolkit';

/**
 * Notifies Chainhooks of the progress of the Stacks index via a message sent to a Redis queue. This
 * message will contain a block header for each new canonical block as well as headers for those
 * that need to be rolled back from a re-org.
 */
export class RedisNotifier {
  private readonly redis: Redis | Cluster;
  private readonly chainId: ChainID;
  private readonly queue: string;

  constructor() {
    this.redis = this.newRedisConnection();
    this.chainId = getApiConfiguredChainID();
    this.queue = process.env.REDIS_QUEUE ?? 'chainhooks:stacks:index-progress';
    logger.info(`RedisNotifier initialized for queue ${this.queue}`);
  }

  /**
   * Broadcast index progress message to the Redis queue.
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
    logger.debug(message, 'RedisNotifier broadcasting index progress message');
    await this.redis.rpush(this.queue, JSON.stringify(message));
  }

  async close() {
    await this.redis.quit();
  }

  /**
   * Create a new Redis connection based on the environment variables. This will auto-select a
   * single connection, cluster or sentinel.
   */
  private newRedisConnection(): Redis | Cluster {
    const baseOptions: RedisOptions = {
      retryStrategy: times => Math.min(times * 50, 2000),
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES ?? '20'),
      connectTimeout: parseInt(process.env.REDIS_CONNECTION_TIMEOUT ?? '10000'),
      commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT ?? '5000'),
      lazyConnect: true,
    };

    // Single Redis instance with URL
    if (process.env.REDIS_URL) {
      logger.info(`RedisNotifier connecting to redis at ${process.env.REDIS_URL}`);
      return new Redis(process.env.REDIS_URL, baseOptions);
    }

    // Redis Cluster configuration
    if (process.env.REDIS_CLUSTER_NODES && process.env.REDIS_CLUSTER_NODES.length > 0) {
      let isSRVRecord = false;
      const clusterNodesArray = process.env.REDIS_CLUSTER_NODES.split(',');
      if (clusterNodesArray.length === 1) {
        isSRVRecord = true;
      }
      logger.info(
        `RedisNotifier connecting to redis cluster at ${process.env.REDIS_CLUSTER_NODES}`
      );
      return new Redis.Cluster(clusterNodesArray, {
        ...baseOptions,
        redisOptions: {
          ...baseOptions,
          password: process.env.REDIS_CLUSTER_PASSWORD,
        },
        useSRVRecords: isSRVRecord,
        clusterRetryStrategy: times => Math.min(times * 50, 2000),
      });
    }

    // Redis Sentinel configuration
    if (process.env.REDIS_SENTINELS) {
      const sentinels = process.env.REDIS_SENTINELS.split(',');
      logger.info(`RedisNotifier connecting to redis sentinel at ${process.env.REDIS_SENTINELS}`);
      return new Redis({
        ...baseOptions,
        sentinels: sentinels.map(sentinel => {
          const [host, port] = sentinel.split(':');
          return { host, port: parseInt(port) };
        }),
        name: process.env.REDIS_SENTINEL_MASTER,
        password: process.env.REDIS_SENTINEL_PASSWORD,
        sentinelPassword: process.env.REDIS_SENTINEL_AUTH_PASSWORD,
        sentinelRetryStrategy: times => Math.min(times * 50, 2000),
      });
    }

    throw new Error(
      'Redis configuration required. Please set REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES'
    );
  }
}
