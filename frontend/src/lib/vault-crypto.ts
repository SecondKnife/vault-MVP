export interface EncryptedPackage {
  encrypted_session_key: string
  iv: string
  ciphertext: string
  sha256_checksum: string
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "")
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Encrypt a JSON payload client-side using Hybrid Encryption:
 * - AES-256-GCM (random per-submission session key + 12-byte IV)
 * - RSA-OAEP (SHA-256) wrapping the AES session key with the local vault's public key
 * - SHA-256 checksum over raw ciphertext bytes for integrity verification
 */
export async function encryptForVault(
  payload: Record<string, unknown>,
  publicKeyPem: string,
): Promise<EncryptedPackage> {
  if (!publicKeyPem.trim()) {
    throw new Error("Vault public key is not configured (NEXT_PUBLIC_VAULT_PUBLIC_KEY).")
  }

  const spkiBuffer = pemToArrayBuffer(publicKeyPem)
  const rsaPublicKey = await window.crypto.subtle.importKey(
    "spki",
    spkiBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  )

  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  )

  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const encodedPayload = new TextEncoder().encode(JSON.stringify(payload))

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encodedPayload,
  )

  const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey)
  const wrappedKeyBuffer = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    rawAesKey,
  )

  const checksumBuffer = await window.crypto.subtle.digest("SHA-256", ciphertextBuffer)

  return {
    encrypted_session_key: bytesToBase64(new Uint8Array(wrappedKeyBuffer)),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    sha256_checksum: bufferToHex(checksumBuffer),
  }
}
