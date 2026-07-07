import type { D1Migration } from 'cloudflare:test'
import type { Env } from './types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

declare module 'vitest' {
  export interface ProvidedContext {
    migrations: D1Migration[]
  }
}
