import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * node:sqlite's DatabaseSync accepts anonymous `?` placeholders via
 * `.get(...params)` but rejects D1-style numbered `?1` / `?2` bindings with
 * SQLITE_RANGE ("column index out of range"). Cloudflare D1 accepts both.
 * Expand numbered placeholders in appearance order so community SQL (and any
 * other D1-numbered queries) run under the in-memory test driver.
 */
function expandNumberedParams(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  if (!/\?\d+/.test(sql)) return { sql, params }
  const expanded: unknown[] = []
  const rewritten = sql.replace(/\?(\d+)/g, (_match, digits: string) => {
    const index = Number(digits) - 1
    expanded.push(params[index])
    return '?'
  })
  return { sql: rewritten, params: expanded }
}

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.database, this.sql, params)
  }

  private prepared() {
    const { sql, params } = expandNumberedParams(this.sql, this.params)
    return { statement: this.database.prepare(sql), params }
  }

  async all<T>() {
    const { statement, params } = this.prepared()
    return { results: statement.all(...params) as T[] }
  }

  async first<T>() {
    const { statement, params } = this.prepared()
    return (statement.get(...params) as T | undefined) ?? null
  }

  async run() {
    const { statement, params } = this.prepared()
    const result = statement.run(...params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

export function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql)
    },
    async batch(statements: SqliteD1Statement[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  } as unknown as D1Database
}

/**
 * In-memory database with real migration files applied, in the order given.
 * Tests read the same SQL production runs, so a column renamed in a migration
 * fails the test rather than passing against a hand-written copy of the schema.
 */
export function migratedDatabase(...sqlFileUrls: URL[]): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  for (const url of sqlFileUrls) database.exec(readFileSync(url, 'utf8'))
  return database
}
