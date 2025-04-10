import { loadDotEnv } from '../../src/helpers';

// ts-unused-exports:disable-next-line
export default (): void => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  process.env.STACKS_API_ENABLE_LEGACY_ENDPOINTS = '1';
  console.log('Jest - setup done');
};
