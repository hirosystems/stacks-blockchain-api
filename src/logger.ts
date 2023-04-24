import pino from 'pino';
import pinoHttp from 'pino-http';

import { isDevEnv } from './helpers';

// API log levels
const logLevels = {
  verbose: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

// Common logging configuration
const loggingConfiguration = {
  base: undefined,
  level: process.env.STACKS_API_LOG_LEVEL_ENV_VAR || 'info',
  customLevels: logLevels,
  useOnlyCustomLevels: true,
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date(Date.now()).toISOString()}"`,
  formatters: {
    level: (label: any) => {
      return { level: label.toLowerCase() };
    },
  },
  mixin: function () {
    return { component: 'core-api' };
  },
  customLogLevel: function (_req: any, res: any, err: any) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
};

// ad-hoc logger
export const logger = pino(loggingConfiguration);
// logger middleware used by the web application framework
export const loggerMiddleware = pinoHttp(loggingConfiguration);

/*
 * log error function.
 */
export function logError(message: string, ...errorData: any[]) {
  if (isDevEnv) {
    console.error(message);
    if (errorData?.length > 0) {
      errorData.forEach(e => console.error(e));
    }
  } else {
    if (errorData?.length > 0) {
      logger.error(message, ...errorData);
    } else {
      logger.error(message);
    }
  }
}
