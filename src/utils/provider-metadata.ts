const SENSITIVE_KEY_PARTS = ['token', 'secret', 'code', 'authorization', 'password']

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

export function sanitizeProviderMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderMetadata)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      continue
    }
    sanitized[key] = sanitizeProviderMetadata(child)
  }
  return sanitized
}
