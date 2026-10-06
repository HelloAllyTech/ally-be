import { CryptoService } from 'src/common/service/crypto.service';
import { HelplineContentCipher } from '../helpline-content-cipher.service';

/** A fixed 32-byte test key (hex). Never a real key. */
export const TEST_PHI_KEY = 'ab'.repeat(32);

/**
 * A REAL cipher (AES-256-GCM through CryptoService) with a test key, for
 * specs that construct helpline services by hand. Real rather than a stub so
 * every spec that writes or reads through it exercises the actual format.
 */
export function testCipher(key: string | null = TEST_PHI_KEY) {
  const config = { phiData: { phiDataEncryptionKey: key ?? undefined } };
  return new HelplineContentCipher(
    new CryptoService(config as never),
    config as never,
  );
}
