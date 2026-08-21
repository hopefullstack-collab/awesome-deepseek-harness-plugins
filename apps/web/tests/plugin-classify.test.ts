import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadClassificationQueue,
  neuronsSpentToday,
  recordNeuronSpend,
  saveClassifications,
  setCatalogState,
  type ClassificationCandidate,
} from '../worker/lib/catalog-db'
import {
  isChinese,
  resolveDescriptions,
  responseSchema,
  runPluginClassifyTask,
  systemPrompt,
  validateItem,
  CLASSIFIER_VERSION,
  type ClassifierItem,
} from '../worker/lib/plugin-classify-task'

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.database, this.sql, params)
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] }
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

function sqliteD1(database: DatabaseSync): D1Database {
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

/** 0005 rebuilds the catalog from the 0002 tables, so both must run in order. */
function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  for (const file of [
    '0001_github_star_snapshots.sql',
    '0002_plugin_catalog.sql',
    '0005_catalog_plugins.sql',
    '0006_ai_classification.sql',
  ]) {
    database.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
  return database
}

const NOW = '2026-08-17T00:00:00Z'

function seedRepository(
  database: DatabaseSync,
  id: number,
  fullName: string,
  options: { description?: string | null; stars?: number; fromTopic?: boolean } = {},
): void {
  const [owner, name] = fullName.split('/')
  database.prepare(
    `INSERT INTO catalog_repositories (
       id, github_id, full_name, normalized_full_name, owner, repository_name, html_url,
       github_description, stars, from_topic,
       first_seen_at, last_seen_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, id * 100, fullName, fullName.toLowerCase(), owner, name,
    `https://github.com/${fullName}`, options.description ?? null, options.stars ?? 0,
    options.fromTopic === false ? 0 : 1, NOW, NOW, NOW, NOW)
}

/** Adds one plugin row; `curated` fills the curator-owned columns. */
function seedPlugin(
  database: DatabaseSync,
  repositoryId: number,
  pluginId: string,
  options: {
    pluginPath?: string
    curated?: boolean
    fromPr?: boolean
    packageName?: string | null
    validation?: string
  } = {},
): void {
  const path = options.pluginPath ?? ''
  database.prepare(
    `INSERT INTO catalog_plugins (
       repository_id, plugin_id, normalized_plugin_id, plugin_path, from_pr,
       curated_name, curated_category, curated_description_en, curated_description_zh,
       curated_added, package_name, validation_status,
       first_seen_at, last_seen_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repositoryId, pluginId, pluginId.toLowerCase(), path,
    options.curated || options.fromPr ? 1 : 0,
    options.curated ? 'Curated name' : null,
    options.curated ? 'tools' : null,
    options.curated ? 'Curated English blurb.' : null,
    options.curated ? '人工中文描述。' : null,
    options.curated ? '2026-01-01' : null,
    options.packageName ?? null,
    options.validation ?? 'accepted',
    NOW, NOW, NOW, NOW,
  )
}

const candidate = (over: Partial<ClassificationCandidate> = {}): ClassificationCandidate => ({
  repositoryId: 1, pluginPath: '', pluginId: 'owner/dsh-x', packageName: null,
  repositoryName: 'dsh-x', description: null, stars: 0, ...over,
})
const item = (over: Partial<ClassifierItem> = {}): ClassifierItem => ({
  id: 0, category: 'tools', confidence: 0.9,
  description_en: 'Adds a searchable command palette to the composer.',
  description_zh: '为输入框添加可搜索的命令面板。', ...over,
})

describe('0006 migration', () => {
  it('adds the ai columns without disturbing curated data', () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/curated')
    seedPlugin(database, 1, 'owner/curated', { curated: true })
    const row = database.prepare('SELECT * FROM catalog_plugins').get() as Record<string, unknown>
    expect(row.curated_category).toBe('tools')
    expect(row.ai_category).toBeNull()
    expect(row.ai_classifier_version).toBeNull()
  })
})

describe('loadClassificationQueue', () => {
  let database: DatabaseSync
  beforeEach(() => { database = migratedDatabase() })

  it('skips plugins a curator already categorised', async () => {
    seedRepository(database, 1, 'owner/curated')
    seedPlugin(database, 1, 'owner/curated', { curated: true })
    seedRepository(database, 2, 'owner/discovered')
    seedPlugin(database, 2, 'owner/discovered')

    const queue = await loadClassificationQueue(sqliteD1(database), CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })
    expect(queue.map((entry) => entry.pluginId)).toEqual(['owner/discovered'])
  })

  it('still classifies a submitted plugin that carries no curated category', async () => {
    // from_pr without curated columns: published, but nobody wrote a category.
    seedRepository(database, 1, 'owner/submitted')
    seedPlugin(database, 1, 'owner/submitted', { fromPr: true })
    const queue = await loadClassificationQueue(sqliteD1(database), CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })
    expect(queue).toHaveLength(1)
  })

  it('skips rows already classified at the current version, re-enqueues on bump', async () => {
    seedRepository(database, 1, 'owner/discovered')
    seedPlugin(database, 1, 'owner/discovered')
    const db = sqliteD1(database)
    await saveClassifications(db, [{
      repositoryId: 1, pluginPath: '', category: 'ui',
      descriptionEn: 'en.', descriptionZh: '中文。', descriptionOrigin: 'generated',
    }], CLASSIFIER_VERSION)

    expect(await loadClassificationQueue(db, CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })).toHaveLength(0)
    expect(await loadClassificationQueue(db, 'v2-next', 10, { includeTopicDiscoveries: true })).toHaveLength(1)
  })

  it('treats each monorepo subpackage as its own candidate', async () => {
    seedRepository(database, 1, 'owner/mono', { description: 'A monorepo.' })
    seedPlugin(database, 1, 'owner/mono/packages/a', {
      pluginPath: 'packages/a', packageName: '@owner/dsh-a',
    })
    seedPlugin(database, 1, 'owner/mono/packages/b', {
      pluginPath: 'packages/b', packageName: '@owner/dsh-b',
    })

    const queue = await loadClassificationQueue(sqliteD1(database), CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })
    expect(queue).toHaveLength(2)
    expect(queue.map((entry) => entry.packageName).sort())
      .toEqual(['@owner/dsh-a', '@owner/dsh-b'])
  })

  it('excludes topic plugins that have not been accepted', async () => {
    seedRepository(database, 1, 'owner/pending')
    seedPlugin(database, 1, 'owner/pending', { validation: 'rejected' })
    expect(await loadClassificationQueue(sqliteD1(database), CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })).toHaveLength(0)
  })

  it('orders by stars so the most visible plugins are fixed first', async () => {
    seedRepository(database, 1, 'owner/low', { stars: 3 })
    seedPlugin(database, 1, 'owner/low')
    seedRepository(database, 2, 'owner/high', { stars: 900 })
    seedPlugin(database, 2, 'owner/high')
    const queue = await loadClassificationQueue(sqliteD1(database), CLASSIFIER_VERSION, 10, { includeTopicDiscoveries: true })
    expect(queue.map((entry) => entry.pluginId)).toEqual(['owner/high', 'owner/low'])
  })
})

describe('saveClassifications', () => {
  it('cannot touch a curated plugin even when handed one', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/curated')
    seedPlugin(database, 1, 'owner/curated', { curated: true })

    const written = await saveClassifications(sqliteD1(database), [{
      repositoryId: 1, pluginPath: '', category: 'fun',
      descriptionEn: 'AI tried to overwrite this.', descriptionZh: 'AI 想覆盖这个。',
      descriptionOrigin: 'generated',
    }], CLASSIFIER_VERSION)

    expect(written).toBe(0)
    const row = database.prepare('SELECT * FROM catalog_plugins').get() as Record<string, unknown>
    expect(row.curated_category).toBe('tools')
    expect(row.curated_description_en).toBe('Curated English blurb.')
    expect(row.ai_category).toBeNull()
  })

  it('writes onto the right subpackage row, not its sibling', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/mono')
    seedPlugin(database, 1, 'owner/mono/packages/a', { pluginPath: 'packages/a' })
    seedPlugin(database, 1, 'owner/mono/packages/b', { pluginPath: 'packages/b' })

    await saveClassifications(sqliteD1(database), [{
      repositoryId: 1, pluginPath: 'packages/b', category: 'memory',
      descriptionEn: 'en.', descriptionZh: '中文。', descriptionOrigin: 'generated',
    }], CLASSIFIER_VERSION)

    const rows = database.prepare(
      'SELECT plugin_path, ai_category FROM catalog_plugins ORDER BY plugin_path',
    ).all() as { plugin_path: string; ai_category: string | null }[]
    expect(rows).toEqual([
      { plugin_path: 'packages/a', ai_category: null },
      { plugin_path: 'packages/b', ai_category: 'memory' },
    ])
  })
})

describe('resolveDescriptions', () => {
  it('keeps an English author blurb verbatim and takes only the translation', () => {
    const result = resolveDescriptions(
      candidate({ description: 'Original author text.' }),
      item({ description_en: 'Model rewrote it.', description_zh: '模型翻译。' }),
    )
    expect(result.descriptionEn).toBe('Original author text.')
    expect(result.descriptionZh).toBe('模型翻译。')
    expect(result.descriptionOrigin).toBe('author_en')
  })

  it('keeps a Chinese author blurb verbatim', () => {
    const result = resolveDescriptions(
      candidate({ description: '这是作者写的中文描述。' }),
      item({ description_en: 'Model translation.', description_zh: '模型改写的中文。' }),
    )
    expect(result.descriptionZh).toBe('这是作者写的中文描述。')
    expect(result.descriptionEn).toBe('Model translation.')
    expect(result.descriptionOrigin).toBe('author_zh')
  })

  it('does not let a monorepo subpackage claim the repository blurb', () => {
    // Every sibling shares one repository description; handing it to each of
    // them verbatim would give the whole monorepo one identical blurb.
    const result = resolveDescriptions(
      candidate({
        pluginPath: 'packages/dsh-theme-nord',
        pluginId: 'owner/mono/packages/dsh-theme-nord',
        description: 'Monorepo of design system packages.',
      }),
      item({ description_en: 'Ships the Nord palette.', description_zh: '提供 Nord 配色。' }),
    )
    expect(result.descriptionOrigin).toBe('generated')
    expect(result.descriptionEn).toBe('Ships the Nord palette.')
    expect(result.descriptionZh).toBe('提供 Nord 配色。')
  })

  it('still lets a repository-level plugin claim it', () => {
    const result = resolveDescriptions(
      candidate({ pluginPath: '', description: 'A single-plugin repository.' }),
      item(),
    )
    expect(result.descriptionOrigin).toBe('author_en')
    expect(result.descriptionEn).toBe('A single-plugin repository.')
  })

  it('treats the synthesised placeholder as no description at all', () => {
    const result = resolveDescriptions(
      candidate({ description: 'owner/dsh-x discovered from GitHub.' }),
      item(),
    )
    expect(result.descriptionOrigin).toBe('generated')
    expect(result.descriptionEn).toBe(item().description_en)
  })
})

describe('validateItem', () => {
  it('accepts a well-formed item', () => {
    expect(validateItem(item(), { id: 0 })).toEqual([])
  })

  it('flags a description cut off mid-sentence', () => {
    expect(validateItem(item({ description_en: 'Renders reports in mut' }), { id: 0 }))
      .toContain('en_truncated')
  })

  it('flags a mismatched id', () => {
    expect(validateItem(item({ id: 7 }), { id: 0 })).toContain('id_mismatch')
  })

  it('flags a category outside the catalog', () => {
    expect(validateItem(item({ category: 'networking' }), { id: 0 })).toContain('unknown_category')
  })

  it('flags an over-long description', () => {
    expect(validateItem(item({ description_en: `${'a'.repeat(220)}.` }), { id: 0 }))
      .toContain('en_too_long')
  })
})

describe('isChinese', () => {
  it.each([
    ['这是中文描述。', true],
    ['Adds a command palette.', false],
    ['支持 MCP 工具接入。', true],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(isChinese(text)).toBe(expected)
  })
})

describe('responseSchema', () => {
  it('is flat, because Workers AI 500s on the nested {name, schema} form', () => {
    const schema = responseSchema()
    expect(schema.type).toBe('object')
    expect(schema).not.toHaveProperty('name')
  })

  it('constrains category to the catalog ids plus unclassified', () => {
    const enumValues = responseSchema().properties.items.items.properties.category.enum
    expect(enumValues).toContain('tools')
    expect(enumValues).toContain('unclassified')
    expect(enumValues).not.toContain('networking')
  })

  it('sets maxLength far above the target so it never truncates mid-sentence', () => {
    const properties = responseSchema().properties.items.items.properties
    expect(properties.description_en.maxLength).toBeGreaterThan(200)
    expect(properties.description_zh.maxLength).toBeGreaterThan(100)
  })
})

describe('systemPrompt', () => {
  it('contains the word json, which DeepSeek requires for JSON output', () => {
    expect(systemPrompt().toLowerCase()).toContain('json')
  })

  it('lists every catalog category', () => {
    const prompt = systemPrompt()
    for (const id of ['ui', 'theme', 'session', 'memory', 'tools', 'skill',
      'workflow', 'notify', 'model', 'dev', 'fun']) {
      expect(prompt).toContain(`- ${id}:`)
    }
  })

  it('warns that monorepo siblings share one repository blurb', () => {
    expect(systemPrompt()).toContain('子包')
  })
})

describe('runPluginClassifyTask', () => {
  function envWith(database: DatabaseSync, run: ReturnType<typeof vi.fn>): Env {
    return {
      CATALOG_DB: sqliteD1(database),
      AI: { run },
      CATALOG_CACHE: { get: vi.fn(), put: vi.fn() },
      // Fixtures seed topic-discovered rows; exercise the enabled path.
      TOPIC_DISCOVERY_ENABLED: '1',
    } as unknown as Env
  }
  const reply = (items: unknown[], neurons = 12) => ({
    choices: [{ message: { content: JSON.stringify({ items }) } }],
    usage: { neurons },
  })

  it('classifies the queue and stops when it empties', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a', { description: 'Adds a palette.' })
    seedPlugin(database, 1, 'owner/dsh-a')
    const run = vi.fn()
      .mockResolvedValueOnce(reply([{ ...item(), id: 0 }]))
      .mockResolvedValue(reply([]))

    const result = await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })
    expect(result.written).toBe(1)
    expect(result.neurons).toBe(12)

    const row = database.prepare('SELECT * FROM catalog_plugins').get() as Record<string, unknown>
    expect(row.ai_category).toBe('tools')
    expect(row.ai_classifier_version).toBe(CLASSIFIER_VERSION)
    // Author's own words are preserved; only the Chinese side comes from the model.
    expect(row.ai_description_en).toBe('Adds a palette.')
    expect(row.ai_description_origin).toBe('author_en')
  })

  it('feeds the package name so monorepo siblings are told apart', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/mono', { description: 'A monorepo.' })
    seedPlugin(database, 1, 'owner/mono/packages/a', {
      pluginPath: 'packages/a', packageName: '@owner/dsh-a',
    })
    const run = vi.fn()
      .mockResolvedValueOnce(reply([{ ...item(), id: 0 }]))
      .mockResolvedValue(reply([]))
    await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })

    const [, payload] = run.mock.calls[0] as [string, { messages: { content: string }[] }]
    const sent = JSON.parse(payload.messages[1].content)
    expect(sent[0].name).toBe('@owner/dsh-a')
    expect(sent[0].plugin_id).toBe('owner/mono/packages/a')
  })

  it('leaves unclassified verdicts out of the ai columns', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const run = vi.fn().mockResolvedValue(reply([{ ...item(), category: 'unclassified' }]))

    const result = await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })
    expect(result.written).toBe(0)
    expect(result.rejected).toBe(1)
    const row = database.prepare('SELECT ai_category FROM catalog_plugins').get()
    expect(row).toEqual({ ai_category: null })
  })

  it('drops an item whose id does not line up instead of misattributing it', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const run = vi.fn().mockResolvedValue(reply([{ ...item(), id: 99 }]))

    const result = await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })
    expect(result.written).toBe(0)
    expect(result.rejected).toBe(1)
  })

  it('stops before starting when the daily neuron budget is gone', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    await recordNeuronSpend(sqliteD1(database), 9500, new Date().toISOString())
    const run = vi.fn()

    const result = await runPluginClassifyTask(envWith(database, run), Date.now(), {
      dailyBudget: 9000,
    })
    expect(result.budgetExhausted).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('reads the daily budget from catalog_state so draining a backlog needs no deploy', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const db = sqliteD1(database)
    await recordNeuronSpend(db, 9500, new Date().toISOString())
    // Default 9000 would stop here; an override of 0 removes the cap.
    await setCatalogState(db, 'classify_daily_neuron_budget', '0')
    const run = vi.fn()
      .mockResolvedValueOnce(reply([{ ...item(), id: 0 }]))
      .mockResolvedValue(reply([]))

    const result = await runPluginClassifyTask(envWith(database, run), Date.now())
    expect(result.budgetExhausted).toBeUndefined()
    expect(result.written).toBe(1)
  })

  it('ignores a malformed budget override instead of disabling the cap', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const db = sqliteD1(database)
    await recordNeuronSpend(db, 9500, new Date().toISOString())
    await setCatalogState(db, 'classify_daily_neuron_budget', 'unlimited')
    const run = vi.fn()

    const result = await runPluginClassifyTask(envWith(database, run), Date.now())
    expect(result.budgetExhausted).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('accumulates neuron spend per UTC day', async () => {
    const db = sqliteD1(migratedDatabase())
    await recordNeuronSpend(db, 100, '2026-08-17T01:00:00Z')
    await recordNeuronSpend(db, 250, '2026-08-17T23:00:00Z')
    expect(await neuronsSpentToday(db, '2026-08-17T12:00:00Z')).toBe(350)
    expect(await neuronsSpentToday(db, '2026-08-18T00:00:00Z')).toBe(0)
  })

  it('survives an AI failure without writing anything', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const run = vi.fn().mockRejectedValue(new Error('AiError: out of capacity'))

    const result = await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })
    expect(result.batchFailures).toBe(1)
    expect(result.written).toBe(0)
  })

  it('disables thinking and asks for a flat json_schema', async () => {
    const database = migratedDatabase()
    seedRepository(database, 1, 'owner/dsh-a')
    seedPlugin(database, 1, 'owner/dsh-a')
    const run = vi.fn().mockResolvedValue(reply([{ ...item(), id: 0 }]))
    await runPluginClassifyTask(envWith(database, run), Date.now(), { batchSize: 5 })

    const [, payload] = run.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect((payload.response_format as { type: string }).type).toBe('json_schema')
  })
})
