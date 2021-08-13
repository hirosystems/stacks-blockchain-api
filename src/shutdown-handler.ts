import { logError, logger, resolveOrTimeout } from './helpers';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export type ShutdownHandler = () => void | PromiseLike<void>;
export type ShutdownConfig = {
  name: string;
  handler: ShutdownHandler;
  forceKillable: boolean;
  forceKillHandler?: ShutdownHandler;
};

const shutdownConfigs: ShutdownConfig[] = [];

export let isShuttingDown = false;

async function startShutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const timeoutMs = 5000;
  let errorEncountered = false;
  for (const config of shutdownConfigs) {
    try {
      logger.info(`Closing ${config.name}...`);
      const gracefulShutdown = await resolveOrTimeout(Promise.resolve(config.handler()), timeoutMs);
      if (!gracefulShutdown) {
        if (config.forceKillable && config.forceKillHandler) {
          await Promise.resolve(config.forceKillHandler());
        } else {
          logError(
            `${config.name} has taken longer than ${timeoutMs}ms to shutdown, possibly hanging indefinitely`
          );
        }
      } else {
        logger.info(`${config.name} closed`);
      }
    } catch (error) {
      errorEncountered = true;
      logError(`Error running ${config.name} shutdown handler`, error);
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
    logError(`unhandledRejection ${(error as any)?.message ?? error}`, error as Error);
    logger.error(`Shutting down... received unhandledRejection.`);
    void startShutdown();
  });
  process.once('uncaughtException', error => {
    logError(`Received uncaughtException: ${error}`, error);
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
