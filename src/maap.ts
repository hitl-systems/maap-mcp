/**
 * The HTTP half: what the maap API takes and returns, and nothing about MCP.
 *
 * The response shapes are plain interfaces, not schemas, and every optional field is read as
 * optional. A client that re-declares the server's contract in zod has to be redeployed when a
 * field is added — and would have been wrong for a day when `state`/`questions` replaced the
 * old request shape. The gateway already validates; its 400s are written for a person to read,
 * so passing one through beats failing locally with a worse message.
 */
export const DEFAULT_BASE_URL = 'https://dash.hitl.systems'

/**
 * The gateway's own limits, mirrored for the tool schema so an agent is told the ceiling
 * instead of discovering it as a 400. Published at /docs/api — if they change there, change
 * them here.
 */
export const LIMITS = { questions: 32, examples: 16, levels: 19, recordChars: 8_000 } as const

export const TIMEOUT_MS = { estimate: 120_000, read: 45_000 } as const

export type Primitive = 'amount' | 'count' | 'measure'

export interface Target {
  id: string
  primitive: Primitive
  unit?: string | null
  description: string
}

export interface Answer {
  median: number
  quantiles?: Record<string, number>
  interval80?: [number, number] | null
  intervals?: Record<string, [number, number]>
  prob_over?: Record<string, number>
  pmf?: Record<string, number> | null
  pmf_note?: string | null
  mean?: number | null
  mean_warning?: string | null
  unit?: string | null
  primitive: Primitive
  regime: string
  novelty_flag?: boolean
  k?: number | null
  calibration?: string | null
  calibration_rule?: string | null
  warning?: string | null
}

export interface Usage {
  questions?: number
  compute_ms?: number
}

export interface EstimateResponse {
  model?: string
  questions: Record<string, Answer>
  usage?: Usage
}

export interface Question {
  type: 'estimate'
  target: string
  levels?: number[]
  interval_levels?: number[]
  thresholds?: number[]
  return_pmf?: boolean
  examples?: { state: unknown; value: number }[]
}

export class MaapError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface Config {
  apiKey: string
  baseUrl: string
}

export const readConfig = (env: Record<string, string | undefined>): Config => {
  const apiKey = env.MAAP_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'MAAP_API_KEY is not set. Create a key at https://dash.hitl.systems/keys and put it in this ' +
        "server's env block.",
    )
  }
  return { apiKey, baseUrl: (env.MAAP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '') }
}

/**
 * One status table, so every tool fails the same way.
 *
 * An agent retries on advice, not on a number: "the model is starting, call again" is
 * actionable where "504" is something to hallucinate about. Each line names the fix.
 */
const describe = (status: number, error: string | undefined): string => {
  if (status === 400) return error ?? 'The request was rejected as malformed.'
  if (status === 401) {
    return 'The API key was rejected. Check MAAP_API_KEY, or create a new key at https://dash.hitl.systems/keys.'
  }
  if (status === 402) {
    return `${error ?? 'The free allowance is used up.'} Ask for an increase at maap@hitl.systems.`
  }
  if (status === 429) {
    return `${error ?? 'Rate limited.'} Wait and try again; the per-minute window clears within a minute.`
  }
  if (status === 504 || status === 503) {
    return 'The model is starting up and did not answer in time. Call again — the second call is fast.'
  }
  return error ?? `The request failed with status ${status}.`
}

const call = async (config: Config, path: string, init: RequestInit, timeout: number): Promise<unknown> => {
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    throw new MaapError(
      504,
      'Could not reach the maap API. The model may be starting up — call again, or check MAAP_BASE_URL.',
    )
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = typeof body === 'object' && body !== null ? (body as { error?: string }).error : undefined
    throw new MaapError(response.status, describe(response.status, error))
  }
  return body
}

export const listTargets = async (config: Config): Promise<Target[]> => {
  const body = await call(config, '/v1/targets', { method: 'GET' }, TIMEOUT_MS.read)
  const targets = (body as { targets?: unknown })?.targets
  if (!Array.isArray(targets)) {
    throw new MaapError(502, 'The target catalogue came back in an unreadable shape.')
  }
  return targets as Target[]
}

export const runEstimate = async (
  config: Config,
  request: { state: unknown; questions: Record<string, Question> },
): Promise<EstimateResponse> => {
  const body = await call(
    config,
    '/v1/estimate',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) },
    TIMEOUT_MS.estimate,
  )

  const questions = (body as { questions?: unknown })?.questions
  if (typeof questions !== 'object' || questions === null) {
    throw new MaapError(502, 'The estimate came back without any answers.')
  }
  return body as EstimateResponse
}
