import Redis, { Cluster, RedisOptions } from 'ioredis';
import { BlockHeader, ReOrgUpdatedEntities } from './common';
import { ChainID } from '@stacks/transactions';
import { getApiConfiguredChainID } from '../helpers';
import { logger } from '@stacks/api-toolkit';
import { ENV } from '../env';

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
    this.queue = ENV.REDIS_QUEUE;
    logger.info(`RedisNotifier initialized for queue ${this.queue}`);
  }

  /**
   * Broadcast index progress message to the Redis queue.
   * @param reOrg - The re-org updated entities, if any
   * @param block - The newest canonical block
   */
  async notify(block: BlockHeader, reOrg: ReOrgUpdatedEntities) {
    const time = Date.now();
    const message = {
      id: `stacks-${block.block_height}-${block.index_block_hash}-${time}`,
      payload: {
        chain: 'stacks',
        network: this.chainId === ChainID.Mainnet ? 'mainnet' : 'testnet',
        time,
        apply_blocks: [
          ...reOrg.markedCanonical.blockHeaders.map(block => ({
            hash: block.index_block_hash,
            index: block.block_height,
            time: block.block_time,
          })),
          {
            hash: block.index_block_hash,
            index: block.block_height,
            time: block.block_time,
          },
        ],
        rollback_blocks: reOrg.markedNonCanonical.blockHeaders.map(block => ({
          hash: block.index_block_hash,
          index: block.block_height,
          time: block.block_time,
        })),
      },
    };
    logger.info(message, 'RedisNotifier broadcasting index progress message');
    await this.redis.xadd(this.queue, '*', 'data', JSON.stringify(message));
    await this.redis.xtrim(this.queue, 'MAXLEN', '~', ENV.REDIS_QUEUE_MAXLEN);
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
      maxRetriesPerRequest: ENV.REDIS_MAX_RETRIES,
      connectTimeout: ENV.REDIS_CONNECTION_TIMEOUT,
      commandTimeout: ENV.REDIS_COMMAND_TIMEOUT,
      lazyConnect: true,
    };

    if (ENV.REDIS_URL) {
      logger.info(`RedisNotifier connecting to redis at ${ENV.REDIS_URL}`);
      return new Redis(ENV.REDIS_URL, baseOptions);
    }

    if (ENV.REDIS_CLUSTER_NODES && ENV.REDIS_CLUSTER_NODES.length > 0) {
      let isSRVRecord = false;
      const clusterNodesArray = ENV.REDIS_CLUSTER_NODES.split(',');
      if (clusterNodesArray.length === 1) {
        isSRVRecord = true;
      }
      logger.info(`RedisNotifier connecting to redis cluster at ${ENV.REDIS_CLUSTER_NODES}`);
      return new Redis.Cluster(clusterNodesArray, {
        ...baseOptions,
        redisOptions: {
          ...baseOptions,
          password: ENV.REDIS_CLUSTER_PASSWORD,
        },
        useSRVRecords: isSRVRecord,
        clusterRetryStrategy: times => Math.min(times * 50, 2000),
      });
    }

    if (ENV.REDIS_SENTINELS) {
      const sentinels = ENV.REDIS_SENTINELS.split(',');
      logger.info(`RedisNotifier connecting to redis sentinel at ${ENV.REDIS_SENTINELS}`);
      return new Redis({
        ...baseOptions,
        sentinels: sentinels.map(sentinel => {
          const [host, port] = sentinel.split(':');
          return { host, port: parseInt(port) };
        }),
        name: ENV.REDIS_SENTINEL_MASTER,
        password: ENV.REDIS_SENTINEL_PASSWORD,
        sentinelPassword: ENV.REDIS_SENTINEL_AUTH_PASSWORD,
        sentinelRetryStrategy: times => Math.min(times * 50, 2000),
      });
    }

    throw new Error(
      'Redis configuration required. Please set REDIS_URL, REDIS_SENTINELS, or REDIS_CLUSTER_NODES'
    );
  }
}
