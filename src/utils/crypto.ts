const TOKEN_VERSION = 'v1'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importEncryptionKey(keyMaterial: string): Promise<CryptoKey> {
  if (keyMaterial.length < 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMaterial))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function generateRandomId(bytes = 16): string {
  const randomBytes = new Uint8Array(bytes)
  crypto.getRandomValues(randomBytes)
  return bytesToBase64Url(randomBytes)
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomId(32)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: bytesToBase64Url(new Uint8Array(digest)) }
}

export async function encryptToken(plaintext: string, keyMaterial: string): Promise<string> {
  const key = await importEncryptionKey(keyMaterial)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return `${TOKEN_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptToken(ciphertext: string, keyMaterial: string): Promise<string> {
  const [version, iv, encrypted] = ciphertext.split('.')
  if (version !== TOKEN_VERSION || !iv || !encrypted || ciphertext.split('.').length !== 3) {
    throw new Error('invalid ciphertext')
  }

  const key = await importEncryptionKey(keyMaterial)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(encrypted),
  )
  return new TextDecoder().decode(plaintext)
}
