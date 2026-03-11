import { Static, Type } from 'typebox';
import envSchema from 'env-schema';

const schema = Type.Object({
  PG_HOST: Type.String({ default: '127.0.0.1' }),
  PG_PORT: Type.Integer({ default: 5490, minimum: 0, maximum: 65535 }),
  PG_USER: Type.String({ default: 'postgres' }),
  PG_PASSWORD: Type.String({ default: 'postgres' }),
  PG_DATABASE: Type.String({ default: 'stacks_blockchain_api' }),
  PG_SCHEMA: Type.String({ default: 'stacks_blockchain_api' }),
  PG_SSL: Type.Boolean({ default: false }),
  /** Idle connection timeout in seconds, defaults to 30. */
  PG_IDLE_TIMEOUT: Type.Integer({ default: 30, minimum: 0 }),
  /** Max connection lifetime in seconds, defaults to 60 */
  PG_MAX_LIFETIME: Type.Integer({ default: 60, minimum: 0 }),
  /** Seconds before force-ending running queries on connection close, defaults to 5 */
  PG_CLOSE_TIMEOUT: Type.Integer({ default: 5, minimum: 0 }),
  /** Statement timeout in seconds */
  PG_STATEMENT_TIMEOUT: Type.Optional(Type.Integer()),
  /** Can be any string, use to specify a use case specific to a deployment */
  PG_APPLICATION_NAME: Type.String({ default: 'stacks-blockchain-api' }),
  /**
   * The connection URI below can be used in place of the PG variables above, but if enabled it must
   * be defined without others or omitted.
   */
  PG_CONNECTION_URI: Type.Optional(Type.String()),
  /** Limit to how many concurrent connections can be created, defaults to 10 */
  PG_CONNECTION_POOL_MAX: Type.Integer({ default: 10, minimum: 0 }),
  /**
   * If your PG deployment implements a combination of primary server and read replicas, you should
   * specify the values below to point to the primary server. The API will use primary when
   * implementing LISTEN/NOTIFY postgres messages for websocket/socket.io support. To avoid any data
   * inconsistencies across replicas, make sure to set `synchronous_commit` to `on` or
   * `remote_apply` on the primary database's configuration. See
   * https://www.postgresql.org/docs/12/runtime-config-wal.html Any value not provided here will
   * fall back to the default equivalent above.
   */
  PG_PRIMARY_HOST: Type.Optional(Type.String()),
  PG_PRIMARY_PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),
  PG_PRIMARY_USER: Type.Optional(Type.String()),
  PG_PRIMARY_PASSWORD: Type.Optional(Type.String()),
  PG_PRIMARY_DATABASE: Type.Optional(Type.String()),
  PG_PRIMARY_SCHEMA: Type.Optional(Type.String()),
  PG_PRIMARY_SSL: Type.Optional(Type.Boolean()),
  PG_PRIMARY_IDLE_TIMEOUT: Type.Optional(Type.Integer({ minimum: 0 })),
  PG_PRIMARY_MAX_LIFETIME: Type.Optional(Type.Integer({ minimum: 0 })),
  PG_PRIMARY_CLOSE_TIMEOUT: Type.Optional(Type.Integer({ minimum: 0 })),
  PG_PRIMARY_STATEMENT_TIMEOUT: Type.Optional(Type.Integer({ minimum: 0 })),
  PG_PRIMARY_CONNECTION_URI: Type.Optional(Type.String()),
  PG_PRIMARY_CONNECTION_POOL_MAX: Type.Optional(Type.Integer({ minimum: 0 })),

  /**
   * If specified, controls the Stacks Blockchain API mode. The possible values are:
   * * `readonly`: Runs the API endpoints without an Event Server that listens to events from a node
   *       and writes them to the local database. The API will only read data from the PG database
   *       specified above to respond to requests.
   * * `writeonly`: Runs the Event Server without API endpoints. Useful when looking to query the
   *       postgres database containing blockchain data exclusively without the overhead of a web
   *       server. If not specified or any other value is provided, the API will run in the default
   *       `read-write` mode (with both Event Server and API endpoints).
   */
  STACKS_API_MODE: Type.Enum(
    { default: 'default', readonly: 'readonly', writeonly: 'writeonly' },
    { default: 'default' }
  ),
  STACKS_BLOCKCHAIN_API_HOST: Type.String({ default: '0.0.0.0' }),
  STACKS_BLOCKCHAIN_API_PORT: Type.Integer({ default: 3999, minimum: 0, maximum: 65535 }),
  /**
   * If enabled, the API will store raw events received from the Stacks node in the
   * `event_observer_requests` table.
   */
  STACKS_API_STORE_RAW_EVENTS: Type.Boolean({ default: true }),
  /**
   * Configure a path to a file containing additional stacks-node `POST /v2/tranascation` URLs for
   * the /v2 proxy to mutlicast. The file should be a newline-delimited list of URLs.
   */
  STACKS_API_EXTRA_TX_ENDPOINTS_FILE: Type.Optional(Type.String()),

  /** Web Socket ping interval to determine client availability, in seconds */
  STACKS_API_WS_PING_INTERVAL: Type.Integer({ default: 5, minimum: 0 }),
  /**
   * Web Socket ping timeout, in seconds. Clients will be dropped if they do not respond with a pong
   * after this time has elapsed.
   */
  STACKS_API_WS_PING_TIMEOUT: Type.Integer({ default: 5, minimum: 0 }),
  /**
   * Web Socket message timeout, in seconds. Clients will be dropped if they do not acknowledge a
   * message after this time has elapsed.
   */
  STACKS_API_WS_MESSAGE_TIMEOUT: Type.Integer({ default: 5, minimum: 0 }),
  /**
   * Web Socket update queue timeout, in seconds. When an update is scheduled (new block, tx update,
   * etc.), we will allow this number of seconds to elapse to allow all subscribed clients to
   * receive new data.
   */
  STACKS_API_WS_UPDATE_QUEUE_TIMEOUT: Type.Integer({ default: 5, minimum: 0 }),

  STACKS_CORE_EVENT_PORT: Type.Integer({ default: 3700, minimum: 0, maximum: 65535 }),
  STACKS_CORE_EVENT_HOST: Type.String({ default: '127.0.0.1' }),
  /**
   * Stacks core event body size limit. Defaults to 500MB.
   */
  STACKS_CORE_EVENT_BODY_LIMIT: Type.Integer({ default: 500000000, minimum: 0 }),
  STACKS_CORE_RPC_HOST: Type.String({ default: '127.0.0.1' }),
  STACKS_CORE_RPC_PORT: Type.Integer({ default: 20443, minimum: 0, maximum: 65535 }),
  STACKS_CORE_PROXY_HOST: Type.String({ default: '127.0.0.1' }),
  STACKS_CORE_PROXY_PORT: Type.Integer({ default: 20443, minimum: 0, maximum: 65535 }),
  /**
   * Stacks core RPC proxy body size limit. Defaults to 10MB.
   */
  STACKS_CORE_PROXY_BODY_LIMIT: Type.Integer({ default: 10000000, minimum: 0 }),
  /** Configure the chainID/networkID; testnet: 0x80000000, mainnet: 0x00000001 */
  STACKS_CHAIN_ID: Type.String({ default: '0x80000000' }),
  /**
   * Configure custom testnet and mainnet chainIDs for other networks such as subnets, multiple
   * values can be set using comma-separated key-value pairs.
   */
  CUSTOM_CHAIN_IDS: Type.Optional(Type.String()),
  SKIP_STACKS_CHAIN_ID_CHECK: Type.Boolean({ default: true }),
  /**
   * Stacks blockchain node type (L1 or subnet). L1 by default. If STACKS_NODE_TYPE is set to
   * subnet, BNS importer is skipped.
   */
  STACKS_NODE_TYPE: Type.Enum({ L1: 'L1', subnet: 'subnet' }, { default: 'L1' }),
  /**
   * If specified, an http server providing profiling capability endpoints will be opened on the
   * given host. This host should not be publicly exposed.
   */
  STACKS_PROFILER_HOST: Type.Optional(Type.String()),
  /**
   * If specified, an http server providing profiling capability endpoints will be opened on the
   * given port. This port should not be publicly exposed.
   */
  STACKS_PROFILER_PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),
  /**
   * Specify max number of STX address to store in an in-memory LRU cache (CPU optimization).
   * Defaults to 50,000, which should result in around 25 megabytes of additional memory usage.
   */
  STACKS_ADDRESS_CACHE_SIZE: Type.Integer({ default: 50000, minimum: 0 }),
  /**
   * Insert concurrency when processing new blocks. If your PostgreSQL is operating on SSD and has
   * multiple CPU cores, consider raising this value, for instance, to 8 or 16.
   */
  STACKS_BLOCK_DATA_INSERT_CONCURRENCY: Type.Integer({ default: 4, minimum: 1 }),

  STACKS_FAUCET_NODE_HOST: Type.Optional(Type.String()),
  STACKS_FAUCET_NODE_PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),

  /**
   * Enables the enhanced transaction fee estimator that will alter results for
   * `/v2/fees/transaction`.
   */
  STACKS_CORE_FEE_ESTIMATOR_ENABLED: Type.Boolean({ default: false }),
  /**
   * Multiplier for all fee estimations returned by Stacks core. Must be between 0.0 and 1.0.
   */
  STACKS_CORE_FEE_ESTIMATION_MODIFIER: Type.Number({ default: 1.0, minimum: 0 }),
  /**
   * How many past tenures the fee estimator will look at to determine if there is a fee market for
   * transactions.
   */
  STACKS_CORE_FEE_PAST_TENURE_FULLNESS_WINDOW: Type.Integer({ default: 5, minimum: 0 }),
  /**
   * Percentage at which past tenure cost dimensions will be considered "full".
   */
  STACKS_CORE_FEE_PAST_DIMENSION_FULLNESS_THRESHOLD: Type.Number({ default: 0.9, minimum: 0 }),
  /**
   * Percentage at which current cost tenures will be considered "busy" in order to determine if we
   * should check previous tenures for a fee market.
   */
  STACKS_CORE_FEE_CURRENT_DIMENSION_FULLNESS_THRESHOLD: Type.Number({ default: 0.5, minimum: 0 }),
  /**
   * Minimum number of blocks the current tenure must have in order to check for "busyness".
   */
  STACKS_CORE_FEE_CURRENT_BLOCK_COUNT_MINIMUM: Type.Integer({ default: 5, minimum: 0 }),

  /**
   * To avoid running unnecessary mempool stats during transaction influx, we use a debounce
   * mechanism for the process. This variable controls the duration it waits until there are no
   * further mempool updates.
   */
  MEMPOOL_STATS_DEBOUNCE_INTERVAL: Type.Integer({ default: 1000, minimum: 0 }),
  /**
   * The maximum duration to wait for further mempool updates after the debounce interval.
   */
  MEMPOOL_STATS_DEBOUNCE_MAX_INTERVAL: Type.Integer({ default: 10000, minimum: 0 }),

  BTC_RPC_HOST: Type.String({ default: 'http://127.0.0.1' }),
  BTC_RPC_PORT: Type.Integer({ default: 18443, minimum: 0, maximum: 65535 }),
  BTC_RPC_USER: Type.String({ default: 'btc' }),
  BTC_RPC_PW: Type.String({ default: 'btc' }),
  BTC_FAUCET_PK: Type.String({
    default: '29c028009a8331358adcc61bb6397377c995d327ac0343ed8e8f1d4d3ef85c27',
  }),
  /**
   * A comma-separated list of STX private keys which will send faucet transactions to accounts that
   * request them. Attempts will always be made from the first account, only once transaction
   * chaining gets too long the faucet will start using the next one.
   */
  FAUCET_PRIVATE_KEY: Type.Optional(Type.String()),

  TESTNET_SEND_MANY_CONTRACT_ID: Type.String({
    default: 'ST3F1X4QGV2SM8XD96X45M6RTQXKA1PZJZZCQAB4B.send-many-memo',
  }),
  MAINNET_SEND_MANY_CONTRACT_ID: Type.String({
    default: 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.send-many-memo',
  }),

  /**
   * Directory containing Stacks 1.0 BNS data extracted from
   * https://storage.googleapis.com/blockstack-v1-migration-data/export-data.tar.gz
   */
  BNS_IMPORT_DIR: Type.Optional(Type.String()),

  /**
   * If enabled this service will connect to the specified SNP redis server and consume events from
   * the SNP stream. This is an alternative to consuming events directly from a stacks-node.
   */
  SNP_EVENT_STREAMING: Type.Boolean({ default: false }),
  SNP_REDIS_URL: Type.String({ default: '127.0.0.1:6379' }),
  SNP_REDIS_STREAM_KEY_PREFIX: Type.Optional(Type.String()),
  /**
   * If enabled, the API will only receive blocks and burn blocks from SNP, ignoring all other
   * events. Useful for speeding up genesis syncs.
   */
  SNP_BLOCKS_ONLY_STREAMING: Type.Boolean({ default: false }),

  /**
   * If enabled this service will notify Redis whenever the Stacks index advances i.e. whenever a
   * new block is confirmed. High Availability Redis is supported via Sentinels, Cluster or a simple
   * Redis connection URL.
   */
  REDIS_NOTIFIER_ENABLED: Type.Boolean({ default: false }),
  REDIS_QUEUE: Type.String({ default: 'chainhooks:stacks:index-progress' }),
  REDIS_URL: Type.Optional(Type.String()),
  REDIS_SENTINELS: Type.Optional(Type.String()),
  REDIS_SENTINEL_MASTER: Type.Optional(Type.String()),
  REDIS_SENTINEL_PASSWORD: Type.Optional(Type.String()),
  REDIS_SENTINEL_AUTH_PASSWORD: Type.Optional(Type.String()),
  REDIS_CLUSTER_NODES: Type.Optional(Type.String()),
  REDIS_CLUSTER_PASSWORD: Type.Optional(Type.String()),
  REDIS_CONNECTION_TIMEOUT: Type.Integer({ default: 10000, minimum: 0 }),
  REDIS_COMMAND_TIMEOUT: Type.Integer({ default: 5000, minimum: 0 }),
  REDIS_MAX_RETRIES: Type.Integer({ default: 20, minimum: 0 }),
  REDIS_QUEUE_MAXLEN: Type.Integer({ default: 10000, minimum: 0 }),
});

type Env = Static<typeof schema>;

export const ENV = envSchema<Env>({
  schema: schema,
  dotenv: true,
});
