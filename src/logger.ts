import pino from 'pino';
import pinoHttp from 'pino-http';

// Common logging configuration
const loggingConfiguration = {
  name: 'stacks-blockchain-api',
  level: process.env.STACKS_API_LOG_LEVEL_ENV_VAR || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string, number: number) => ({ level: label }),
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
