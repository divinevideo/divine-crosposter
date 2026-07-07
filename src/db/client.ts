export type D1ResultMeta = {
  changes?: number
  last_row_id?: number
}

export function changes(result: D1Result): number {
  return (result.meta as D1ResultMeta | undefined)?.changes ?? 0
}

export async function runPrepared(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<D1Result> {
  return db.prepare(query).bind(...bindings).run()
}

export async function firstPrepared<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<T | null> {
  return db.prepare(query).bind(...bindings).first<T>()
}

export async function allPrepared<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const result = await db.prepare(query).bind(...bindings).all<T>()
  return result.results
}

export async function withForeignKeys<T>(db: D1Database, fn: () => Promise<T>): Promise<T> {
  await db.prepare('PRAGMA foreign_keys = ON').run()
  return fn()
}
