import { loadDotEnv } from '../helpers';
// ts-unused-exports:disable-next-line
export default (): void => {
  console.log('Jest - setup..');
  loadDotEnv();
  console.log('Jest - setup done');
};
