import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';

// ts-unused-exports:disable-next-line
export default (): void => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  console.log('Jest - setup done');
};
