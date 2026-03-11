import { ENV } from '../../src/env';

// ts-unused-exports:disable-next-line
export default (): void => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  ENV.PG_DATABASE = 'postgres';
  console.log('Jest - setup done');
};
