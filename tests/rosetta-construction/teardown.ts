import { defaultSetupTeardown } from '../utils/shared-setup';

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - teardown..');
  await defaultSetupTeardown();
  console.log('Jest - teardown done');
};
