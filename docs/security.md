# Security Policy

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via [GitHub Security Advisories](https://github.com/Kareem411/TriCache/security/advisories/new). This lets us triage, verify, and release a patch before public disclosure.

Include as much detail as possible:
- A description of the vulnerability and its potential attack surface
- Minimal reproduction steps or proof-of-concept
- Affected versions and configurations
- Suggested mitigations or patches (if known)

We aim to acknowledge receipt within **48–72 hours** and release security patches within **7 days** for confirmed critical issues.

---

## Cryptography & At-Rest Encryption

TriCache supports AES-256-GCM (default), AES-128-GCM, AES-128-CTR, and XOR (non-cryptographic, dev-only) for at-rest encryption of L2 (Redis) values, disk spill files, and cold-start snapshots.

### Key Generation

Generate cryptographically strong random keys via Node.js:

```bash
# AES-256-GCM (Recommended, 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# AES-128-GCM / AES-128-CTR (16 bytes)
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

Store the key in the `CACHE_ENCRYPTION_KEY` environment variable or inject via secret managers — never hardcode cryptographic keys in source files.

---

## Fail-Open vs. Fail-Closed Key Validation

By default, if an invalid or malformed key length is provided, TriCache logs a warning and stores data unencrypted to maintain availability.

For PCI-DSS, HIPAA, or strict financial environments where unencrypted data at rest is strictly prohibited, enable `strictKeyValidation`:

```typescript
const cache = CacheService.create({
  encryptionKey: process.env.CACHE_ENCRYPTION_KEY,
  strictKeyValidation: true, // Constructor throws if key is invalid
});
```

---

## Live Zero-Downtime Key Rotation

TriCache allows seamless key rotation without requiring a maintenance window:

```typescript
// Writes use newKey; reads seamlessly fall back to previousKey
const cache = CacheService.create({
  encryptionKey: process.env.NEW_KEY,
  previousEncryptionKey: process.env.OLD_KEY,
});
```

Or trigger rotation dynamically in a running process:
```typescript
await cache.rotateEncryptionKey(newKeyBase64, 'aes-256-gcm');
```

---

## Asymmetric Key Envelope Encryption (`EnvelopeEncryption`)

For zero-trust snapshot transfers to object storage (S3, R2, GCS) or cross-region invalidation meshes, TriCache supports asymmetric envelope encryption:

```typescript
import { EnvelopeEncryption } from 'tricache';

const envelope = new EnvelopeEncryption({
  publicKey: process.env.RSA_PUBLIC_KEY,   // Encrypts ephemeral data keys (DEKs)
  privateKey: process.env.RSA_PRIVATE_KEY, // Decrypts DEKs during cold hydration
});

const encryptedBuffer = envelope.encrypt(serializedSnapshot);
const decryptedBuffer = envelope.decrypt(encryptedBuffer);
```

### Security Properties:
* **Ephemeral DEKs**: Each snapshot payload generates a cryptographically random 256-bit AES-GCM data key (`crypto.randomBytes(32)`).
* **Asymmetric Protection**: The ephemeral DEK is wrapped using RSA-OAEP with SHA-256 digest padding.
* **Tamper Proofing (`TRICENV1`)**: Encapsulated within a binary envelope containing authentication tags and big-endian key length bounds, preventing truncation attacks and bit-flipping.
* **Hardware Security Module (HSM) / KMS**: Use `kmsWrapKey` and `kmsUnwrapKey` callbacks to delegate key wrapping directly to AWS KMS, GCP KMS, or Azure Key Vault without storing private keys in application memory.

