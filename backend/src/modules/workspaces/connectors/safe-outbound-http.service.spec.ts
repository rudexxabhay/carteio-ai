import { isPublicAddress } from './safe-outbound-http.service';

describe('connector outbound address policy', () => {
  it.each(['127.0.0.1', '10.0.0.2', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('rejects private or reserved address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('permits public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});
