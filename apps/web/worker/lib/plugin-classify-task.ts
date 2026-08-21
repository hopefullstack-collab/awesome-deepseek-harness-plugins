import { CATALOG_CATEGORIES, isKnownCategoryId } from './categories'
import {
  getCatalogState,
  loadClassificationQueue,
  neuronsSpentToday,
  recordNeuronSpend,
  saveClassifications,
  type ClassificationCandidate,
  type ClassificationResult,
} from './catalog-db'
import { refreshCatalogSnapshot } from './catalog-store'
import { isTopicDiscoveryEnabled } from './site-config'

/**
 * Bump to re-run every AI-owned row. Any change that alters the output — model,
 * prompt, post-processing — must bump this, otherwise the queue keeps skipping
 * rows that were classified by the older logic.
 */
export const CLASSIFIER_VERSION = 'v1-snapshot-signals-20260816'

const MODEL = '@cf/deepseek-ai/deepseek-v4-flash-0731'
const BATCH_SIZE = 22
const TASK_DEADLINE_MS = 8 * 60 * 1000
/** Leaves ~1000 of the 10,000 daily free neurons for other account usage. */
const DEFAULT_DAILY_NEURON_BUDGET = 9000
/** Overrides the daily budget without a deploy; 0 removes the cap entirely. */
const BUDGET_STATE_KEY = 'classify_daily_neuron_budget'
/** Fallback description the snapshot layer synthesises for repos with no README blurb. */
const PLACEHOLDER_DESCRIPTION = / discovered from GitHub\.$/
const MAX_EN = 200
const MAX_ZH = 100

/**
 * How to tell the categories apart. Keyed by the ids in catalog/categories.json;
 * a category without guidance falls back to its English label, so adding a
 * category there never breaks this task.
 */
const CATEGORY_GUIDANCE: Record<string, string> = {
  ui: '面向终端用户的界面增强：布局、输入框、快捷键、侧边栏、渲染、可视化组件',
  theme: '纯外观：配色方案、主题包、字体、图标、暗色模式',
  session: '会话与消息本身：历史记录、消息编辑/分支/导出、上下文管理、多会话切换',
  memory: '跨会话的长期记忆、知识库、向量检索、用户画像持久化',
  tools: '给终端用户增加新能力的工具：搜索、文件操作、代码执行、MCP 工具接入、浏览器控制',
  skill: '打包的技能/提示词集合（skills、prompt 包、agent 人设）',
  workflow: '多步骤自动化编排：任务流水线、定时任务、批处理、CI 集成、agent 编排',
  notify: '与外部服务的通知和集成：webhook、邮件、IM 推送、第三方 SaaS 对接',
  model: '模型与账号接入层：新 provider、API key 管理、路由/负载均衡、token 计费',
  dev: '面向插件开发者的开发与运行时设施：调试、日志、测试、构建、类型、脚手架、遥测',
  fun: '娱乐向：游戏、玩具、彩蛋、纯趣味效果',
}

export function categoryIds(): string[] {
  return CATALOG_CATEGORIES.map((category) => category.id)
}

export function systemPrompt(): string {
  return [
    '你是 DeepSeek Harness 插件目录的分类助手。对输入数组里的每个插件判断类别，并写中英文各一句简介。',
    '',
    '输入字段说明：',
    '- name: 插件的包名（manifest 里声明的），没有时退化为仓库名',
    '- plugin_id: owner/仓库，monorepo 子包还会带上它在仓库内的目录路径',
    '- description: 仓库自述，可能为 null（此时只能从包名和路径推断，宁可给低 confidence）',
    '- stars: GitHub 星数',
    '',
    '注意：同一仓库的多个子包会共用一条仓库自述。若 plugin_id 带子目录，',
    '应以 name 和目录路径为准判断这个子包自己做什么，而不是照搬仓库整体的描述。',
    '',
    '类别：',
    ...CATALOG_CATEGORIES.map((category) =>
      `- ${category.id}: ${CATEGORY_GUIDANCE[category.id] ?? category.label.en}`),
    '',
    '判定优先级（命中即停）：',
    '1. 核心价值是把多步骤串成自动执行的链（流水线/定时/批量/多 agent 协作）→ workflow，即使它同时提供工具',
    '2. 纯粹打包提示词、人设、技能集合，不含自动编排 → skill',
    '3. 面向插件开发者的调试/构建/日志/测试/遥测设施 → dev',
    '4. 给终端用户新增单点能力 → tools',
    '5. 改变会话与消息的存储和操作 → session；只改变消息的视觉呈现 → ui',
    '6. 主题目的是娱乐、玩具、彩蛋 → fun，即使它表现为界面元素',
    '',
    '简介要求：',
    '- 写这个插件"做什么"，不要复述包名，不要出现"这个插件"字样',
    '- description_en 一句话，目标 80-150 字符，必须是完整句子，以句号结尾',
    '- description_zh 一句话，目标 30-70 字，必须是完整句子，以句号结尾',
    '- 宁可短，也不要为了凑长度写成半截话',
    '- 信息不足以判断类别时 category 填 "unclassified"，不要猜',
    '',
    '输出 json：{"items":[{"id":<输入的id>,"category":"...","confidence":0.9,"description_en":"...","description_zh":"..."}]}',
    '必须为每个输入 id 各输出一项，数量与输入完全一致。',
  ].join('\n')
}

/**
 * Flat json_schema. Workers AI rejects OpenAI's nested `{name, schema}` form
 * with a 500 that takes ~56s to surface, so the schema goes in directly.
 *
 * `maxLength` is deliberately far above the target lengths: it truncates rather
 * than shortens, and a value near the target produces mid-word stubs like
 * "…rendered as reports in mut". Real length control lives in the prompt plus
 * `validateItem`.
 */
export function responseSchema() {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            category: { type: 'string', enum: [...categoryIds(), 'unclassified'] },
            confidence: { type: 'number' },
            description_en: { type: 'string', maxLength: 400 },
            description_zh: { type: 'string', maxLength: 200 },
          },
          required: ['id', 'category', 'confidence', 'description_en', 'description_zh'],
        },
      },
    },
    required: ['items'],
  }
}

export interface ClassifierItem {
  id: number
  category: string
  confidence: number
  description_en: string
  description_zh: string
}

/** CJK-heavy text is treated as Chinese; the threshold tolerates embedded ASCII terms. */
export function isChinese(text: string): boolean {
  const characters = [...text]
  if (characters.length === 0) return false
  const cjk = characters.filter((character) => /[一-鿿]/.test(character)).length
  return cjk / characters.length > 0.15
}

/** A sentence that does not end in terminal punctuation was cut off mid-thought. */
function looksTruncated(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && !/[.。!！?？]$/.test(trimmed)
}

/** Reasons this item cannot be trusted; empty means it passes. */
export function validateItem(
  item: ClassifierItem | undefined,
  candidate: { id: number },
): string[] {
  if (!item) return ['missing']
  const reasons: string[] = []
  if (item.id !== candidate.id) reasons.push('id_mismatch')
  if (item.category !== 'unclassified' && !isKnownCategoryId(item.category)) {
    reasons.push('unknown_category')
  }
  const en = String(item.description_en ?? '')
  const zh = [...String(item.description_zh ?? '')]
  if (looksTruncated(en)) reasons.push('en_truncated')
  if (looksTruncated(String(item.description_zh ?? ''))) reasons.push('zh_truncated')
  if (en.length > MAX_EN) reasons.push('en_too_long')
  if (zh.length > MAX_ZH) reasons.push('zh_too_long')
  return reasons
}

/**
 * Apply the author's own words verbatim, letting the model supply only the
 * missing language. The model is never trusted to echo the original back.
 */
export function resolveDescriptions(
  candidate: ClassificationCandidate,
  item: ClassifierItem,
): Pick<ClassificationResult, 'descriptionEn' | 'descriptionZh' | 'descriptionOrigin'> {
  // Only a repository-level plugin may claim the repository blurb as its own.
  // For a monorepo subpackage that text describes the whole repository — every
  // sibling would end up with the same sentence — so it is generated instead.
  const ownsRepositoryBlurb = candidate.pluginPath === ''
  const original = ownsRepositoryBlurb &&
    candidate.description &&
    !PLACEHOLDER_DESCRIPTION.test(candidate.description)
    ? candidate.description
    : null
  if (original === null) {
    return {
      descriptionEn: item.description_en,
      descriptionZh: item.description_zh,
      descriptionOrigin: 'generated',
    }
  }
  if (isChinese(original)) {
    return {
      descriptionEn: item.description_en,
      descriptionZh: original,
      descriptionOrigin: 'author_zh',
    }
  }
  return {
    descriptionEn: original,
    descriptionZh: item.description_zh,
    descriptionOrigin: 'author_en',
  }
}

function promptPayload(candidates: ClassificationCandidate[]) {
  return candidates.map((candidate, index) => ({
    id: index,
    // The manifest package name distinguishes sibling plugins inside a monorepo,
    // where every subpackage shares one repository name and one GitHub blurb.
    name: candidate.packageName ?? candidate.repositoryName,
    plugin_id: candidate.pluginId,
    description: candidate.description && !PLACEHOLDER_DESCRIPTION.test(candidate.description)
      ? candidate.description
      : null,
    stars: candidate.stars,
  }))
}

interface AiChatResponse {
  choices?: { message?: { content?: string } }[]
  response?: string
  usage?: { neurons?: number }
}

function parseItems(response: AiChatResponse): ClassifierItem[] {
  const content = response.choices?.[0]?.message?.content ?? response.response ?? ''
  const parsed: unknown = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''))
  if (!parsed || typeof parsed !== 'object') return []
  const items = (parsed as { items?: unknown }).items
  return Array.isArray(items) ? (items as ClassifierItem[]) : []
}

/**
 * Daily neuron cap, overridable from `catalog_state` so draining a large backlog
 * (or tightening the cap) does not need a deploy. A non-numeric or negative
 * value falls back to the default rather than disabling the cap by accident.
 */
async function resolveDailyBudget(db: D1Database): Promise<number> {
  const stored = await getCatalogState(db, BUDGET_STATE_KEY)
  if (stored === null) return DEFAULT_DAILY_NEURON_BUDGET
  const parsed = Number(stored)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_NEURON_BUDGET
}

export interface ClassifyCounters {
  processed: number
  written: number
  rejected: number
  batchFailures: number
  neurons: number
  budgetExhausted?: boolean
  /** Why items were rejected, e.g. `{ en_truncated: 2 }`. Empty when all passed. */
  rejectReasons?: Record<string, number>
  /** Set when a whole batch was rejected, which stops the round to avoid spinning. */
  stalled?: boolean
}

/**
 * One round of AI classification.
 *
 * Stops on whichever comes first: an empty queue, the 8-minute deadline, or the
 * daily neuron budget. Anything left over is simply picked up next round — the
 * queue is derived from D1 state, so an interrupted round loses no work and
 * repeats none.
 */
export async function runPluginClassifyTask(
  env: Env,
  scheduledTime = Date.now(),
  options: { batchSize?: number; dailyBudget?: number } = {},
): Promise<ClassifyCounters> {
  const deadline = scheduledTime + TASK_DEADLINE_MS
  const batchSize = options.batchSize ?? BATCH_SIZE
  const budget = options.dailyBudget ?? await resolveDailyBudget(env.CATALOG_DB)
  const counters: ClassifyCounters = {
    processed: 0, written: 0, rejected: 0, batchFailures: 0, neurons: 0,
  }
  const rejectReasons: Record<string, number> = {}
  const now = new Date(scheduledTime).toISOString()

  let spentToday = await neuronsSpentToday(env.CATALOG_DB, now)
  if (budget > 0 && spentToday >= budget) return { ...counters, budgetExhausted: true }

  while (Date.now() < deadline) {
    if (budget > 0 && spentToday >= budget) {
      counters.budgetExhausted = true
      break
    }
    const candidates = await loadClassificationQueue(
      env.CATALOG_DB,
      CLASSIFIER_VERSION,
      batchSize,
      { includeTopicDiscoveries: isTopicDiscoveryEnabled(env) },
    )
    if (candidates.length === 0) break

    let response: AiChatResponse
    try {
      response = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: JSON.stringify(promptPayload(candidates)) },
        ],
        max_tokens: 4000,
        // The only switch that actually disables DeepSeek's thinking on Workers
        // AI. `reasoning_effort` is accepted but ignored, and DeepSeek's own
        // `thinking: {type:'disabled'}` is not part of the Workers AI schema.
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', json_schema: responseSchema() },
      } as never) as AiChatResponse
    } catch (error) {
      counters.batchFailures += 1
      console.error(JSON.stringify({
        message: 'classify_batch_failed',
        error: error instanceof Error ? error.message : String(error),
      }))
      break
    }

    const neurons = Number(response.usage?.neurons ?? 0)
    counters.neurons += neurons
    spentToday = await recordNeuronSpend(env.CATALOG_DB, neurons, now)

    let items: ClassifierItem[]
    try {
      items = parseItems(response)
    } catch {
      counters.batchFailures += 1
      break
    }

    const writes: ClassificationResult[] = []
    for (const [index, candidate] of candidates.entries()) {
      counters.processed += 1
      const item = items.find((entry) => entry.id === index)
      const reasons = validateItem(item, { id: index })
      // An unclassifiable verdict is honoured, not forced: leaving the row out
      // keeps the plugin in "待分类" instead of inventing a category.
      if (reasons.length > 0 || !item || item.category === 'unclassified') {
        counters.rejected += 1
        // Without this the queue silently stalls on a plugin the model keeps
        // failing, with no way to tell which one or why.
        for (const reason of reasons.length > 0 ? reasons : ['unclassified_verdict']) {
          rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1
        }
        continue
      }
      writes.push({
        repositoryId: candidate.repositoryId,
        pluginPath: candidate.pluginPath,
        category: item.category,
        ...resolveDescriptions(candidate, item),
      })
    }
    if (writes.length > 0) {
      counters.written += await saveClassifications(
        env.CATALOG_DB, writes, CLASSIFIER_VERSION, now,
      )
    }
    // Every candidate was rejected and none was written: the queue would hand
    // back the same rows forever, so stop rather than spin.
    if (writes.length === 0) {
      counters.stalled = true
      break
    }
  }

  // The verdicts are already committed; a failed snapshot refresh only delays
  // their visibility until the next */15 refresh, so it must not fail the round.
  if (Object.keys(rejectReasons).length > 0) counters.rejectReasons = rejectReasons

  if (counters.written > 0) {
    try {
      await refreshCatalogSnapshot(env, fetch, Date.now())
    } catch (error) {
      console.error(JSON.stringify({
        message: 'classify_snapshot_refresh_failed',
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  return counters
}
