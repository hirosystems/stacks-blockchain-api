import { resolveOrTimeout } from './helpers';
import { logger } from './logger';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

type ShutdownHandler = () => void | PromiseLike<void>;
type ShutdownConfig = {
  name: string;
  handler: ShutdownHandler;
  forceKillable: boolean;
  forceKillHandler?: ShutdownHandler;
};

const shutdownConfigs: ShutdownConfig[] = [];

let isShuttingDown = false;

async function startShutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const timeoutMs = parseInt(process.env['STACKS_SHUTDOWN_FORCE_KILL_TIMEOUT'] ?? '60') * 1000;
  let errorEncountered = false;
  for (const config of shutdownConfigs) {
    try {
      logger.info(`Closing ${config.name}...`);
      const gracefulShutdown = await resolveOrTimeout(
        Promise.resolve(config.handler()),
        timeoutMs,
        !config.forceKillable,
        () =>
          logger.error(
            `${config.name} is taking longer than expected to shutdown, possibly hanging indefinitely`
          )
      );
      if (!gracefulShutdown) {
        if (config.forceKillable && config.forceKillHandler) {
          await Promise.resolve(config.forceKillHandler());
        }
        logger.error(
          `${config.name} was force killed after taking longer than ${timeoutMs}ms to shutdown`
        );
      } else {
        logger.info(`${config.name} closed`);
      }
    } catch (error) {
      errorEncountered = true;
      logger.error(`Error running ${config.name} shutdown handler`, error);
    }
  }
  if (errorEncountered) {
    process.exit(1);
  } else {
    logger.info('App shutdown successful.');
    process.exit();
  }
}

let shutdownSignalsRegistered = false;
function registerShutdownSignals() {
  if (shutdownSignalsRegistered) {
    return;
  }
  shutdownSignalsRegistered = true;

  SHUTDOWN_SIGNALS.forEach(sig => {
    process.once(sig, () => {
      logger.info(`Shutting down... received signal: ${sig}`);
      void startShutdown();
    });
  });
  process.once('unhandledRejection', error => {
    logger.error(error, 'unhandledRejection');
    logger.error(`Shutting down... received unhandledRejection.`);
    void startShutdown();
  });
  process.once('uncaughtException', error => {
    logger.error(`Received uncaughtException: ${error}`, error);
    logger.error(`Shutting down... received uncaughtException.`);
    void startShutdown();
  });
  process.once('beforeExit', () => {
    logger.info(`Shutting down... received beforeExit.`);
    void startShutdown();
  });
}

export function registerShutdownConfig(...configs: ShutdownConfig[]) {
  registerShutdownSignals();
  shutdownConfigs.push(...configs);
}
