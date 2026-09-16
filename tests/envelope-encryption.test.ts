import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { EnvelopeEncryption } from '../src/encryption';
import { CacheService } from '../src/cache-service';
import { createMemorySnapshotAdapter } from '../src/remote-snapshot';

describe('EnvelopeEncryption (Asymmetric Key Envelope Encryption - Phase 1.4)', () => {
  // Generate test RSA 2048 key pair
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const sampleData = Buffer.from('enterprise-snapshot-payload-with-sensitive-data', 'utf8');

  it('encrypts with RSA public key and decrypts with RSA private key', async () => {
    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { publicKey });
    expect(EnvelopeEncryption.isEnvelope(encrypted)).toBe(true);
    expect(encrypted.subarray(0, 8).toString()).toBe('TRICENV1');

    const decrypted = await EnvelopeEncryption.decrypt(encrypted, { privateKey });
    expect(decrypted.equals(sampleData)).toBe(true);
    expect(decrypted.toString('utf8')).toBe('enterprise-snapshot-payload-with-sensitive-data');
  });

  it('detects and rejects tampered ciphertext (AES-GCM AEAD integrity check)', async () => {
    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { publicKey });

    // Flip bits in the ciphertext portion (last byte)
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(EnvelopeEncryption.decrypt(tampered, { privateKey })).rejects.toThrow();
  });

  it('detects and rejects tampered auth tag', async () => {
    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { publicKey });

    // The tag is 16 bytes immediately preceding ciphertext
    const keyLen = encrypted.readUInt32BE(8);
    const tagOffset = 8 + 4 + keyLen + 12;

    const tampered = Buffer.from(encrypted);
    tampered[tagOffset] ^= 0x55;

    await expect(EnvelopeEncryption.decrypt(tampered, { privateKey })).rejects.toThrow();
  });

  it('detects and rejects tampered encrypted DEK', async () => {
    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { publicKey });

    const tampered = Buffer.from(encrypted);
    // Tamper with bytes inside the encrypted DEK
    tampered[14] ^= 0xaa;

    await expect(EnvelopeEncryption.decrypt(tampered, { privateKey })).rejects.toThrow();
  });

  it('rejects truncated or malformed buffers', async () => {
    await expect(EnvelopeEncryption.decrypt(Buffer.from('too_short'), { privateKey })).rejects.toThrow(
      /invalid header/i,
    );

    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { publicKey });
    const truncated = encrypted.subarray(0, 20); // cut off mid-envelope
    await expect(EnvelopeEncryption.decrypt(truncated, { privateKey })).rejects.toThrow(/truncated/i);
  });

  it('supports custom KMS encrypt and decrypt hooks', async () => {
    // Mock KMS simulation: KMS wraps DEK with simple reversal/padding
    const kmsStore = new Map<string, Buffer>();
    let callCount = 0;

    const kmsEncrypt = async (dek: Buffer): Promise<Buffer> => {
      callCount++;
      const id = `kms-key-token-${callCount}`;
      kmsStore.set(id, Buffer.from(dek));
      return Buffer.from(id, 'utf8');
    };

    const kmsDecrypt = async (encryptedDek: Buffer): Promise<Buffer> => {
      const id = encryptedDek.toString('utf8');
      const dek = kmsStore.get(id);
      if (!dek) throw new Error('KMS: key token not found');
      return dek;
    };

    const encrypted = await EnvelopeEncryption.encrypt(sampleData, { kmsEncrypt });
    expect(EnvelopeEncryption.isEnvelope(encrypted)).toBe(true);

    const decrypted = await EnvelopeEncryption.decrypt(encrypted, { kmsDecrypt });
    expect(decrypted.toString('utf8')).toBe('enterprise-snapshot-payload-with-sensitive-data');
  });

  it('integrates seamlessly with CacheService remote snapshot export and hydration', async () => {
    const adapter = createMemorySnapshotAdapter();

    // Source instance: configured with public key (e.g. upload worker without access to private key)
    const ns = `test_envelope_src_${Date.now()}`;
    const sourceCache = CacheService.create({
      namespace: ns,
      disableRedis: true,
      disableDisk: true,
      remoteSnapshot: {
        adapter,
        envelope: { publicKey },
        saveOnShutdown: false,
      },
    });

    await sourceCache.set('user:profile:42', { name: 'Alice', role: 'architect' }, 3600);
    await sourceCache.set('config:rate_limit', { max: 1000 }, 3600);

    const saved = await sourceCache.writeRemoteSnapshot();
    expect(saved).toBe(true);

    // Verify blob in storage is envelope-encrypted
    const rawBlob = await adapter.get();
    expect(rawBlob).not.toBeNull();
    expect(EnvelopeEncryption.isEnvelope(Buffer.from(rawBlob!))).toBe(true);

    // Source instance completed export and shuts down
    await sourceCache.destroy();

    // Target instance: hydrates from remote storage using private key
    const targetCache = CacheService.create({
      namespace: ns,
      disableRedis: true,
      disableDisk: true,
      remoteSnapshot: {
        adapter,
        envelope: { privateKey },
        saveOnShutdown: false,
      },
    });

    await targetCache.ready();

    // Verify hydrated values in target cache L1
    const p1 = targetCache.getIfFresh('user:profile:42');
    expect(p1).toEqual({ name: 'Alice', role: 'architect' });

    const p2 = targetCache.getIfFresh('config:rate_limit');
    expect(p2).toEqual({ max: 1000 });

    await sourceCache.destroy();
    await targetCache.destroy();
  });
});
