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

async function startShutdown(exitCode?: number) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const timeoutMs = 5000;
  let errorEncountered = false;
  for (const config of shutdownConfigs) {
    try {
      logger.info(`Closing ${config.name}...`);
      const gracefulShutdown = await resolveOrTimeout(
        Promise.resolve(config.handler()),
        timeoutMs,
        !config.forceKillable,
        () =>
          logError(
            `${config.name} is taking longer than expected to shutdown, possibly hanging indefinitely`
          )
      );
      if (!gracefulShutdown) {
        if (config.forceKillable && config.forceKillHandler) {
          await Promise.resolve(config.forceKillHandler());
        }
        logError(
          `${config.name} was force killed after taking longer than ${timeoutMs}ms to shutdown`
        );
      } else {
        logger.info(`${config.name} closed`);
      }
    } catch (error) {
      errorEncountered = true;
      logError(`Error running ${config.name} shutdown handler`, error);
    }
  }
  if (errorEncountered) {
    process.exit(exitCode ?? 1);
  } else {
    logger.info('App shutdown successful.');
    process.exit(exitCode);
  }
}

/**
 * The error exit codes used by this app.
 * Note: safe exit code values are 0 to 125 (in many cases, only 8 bits are available for exit code,
 * and in some shells values 126 to 255 are used to encode signal numbers).
 * See https://unix.stackexchange.com/a/418802
 */
export const ExitCodes = {
  UncaughtException: 2,
  UnhandledRejection: 3,
} as const;

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
    void startShutdown(ExitCodes.UnhandledRejection);
  });
  process.once('uncaughtException', error => {
    logError(`Received uncaughtException: ${error}`, error);
    logger.error(`Shutting down... received uncaughtException.`);
    void startShutdown(ExitCodes.UncaughtException);
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
