import { makeBTCFaucetPayment } from '../btc-faucet';

test.skip('trying out btc faucet', async () => {
  const addr = 'n1CVz1z4UTaGCzXHPBujyYyNdC9Vrf4MUv';
  const tx = await makeBTCFaucetPayment(addr);
  expect(tx.getId()).not.toBeFalsy();
});
