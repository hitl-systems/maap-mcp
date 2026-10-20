#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { LIMITS, MaapError, listTargets, readConfig, runEstimate } from './maap'
import { formatAnswer, formatTargets } from './format'

/**
 * maap over MCP: two tools, because an agent needs both halves.
 *
 * `estimate` is the product. `list_targets` exists because a target id is not guessable — the
 * catalogue holds 104 of them with names like `kgl_flight_price_prediction.price`, and a model
 * inventing one gets a 400. Shipping the estimate tool alone would be shipping a keyhole with
 * no key.
 *
 * One question per call. The API takes up to 32 under names you choose, but a flat tool is the
 * one an agent fills in correctly, and two numbers about one case is two calls.
 */
const QUESTION_KEY = 'estimate'

const level = z.number().gt(0).lt(1)

const stateSchema = z
  .union([z.string().min(1), z.record(z.string(), z.unknown())])
  .describe(
    'The case to read, as an object of your own columns ({"airline": "Vistara", "days_left": 9}) ' +
      'or as plain text. Send everything you know about this one case — the model reads it as a record.',
  )

/** Failures reach the agent as advice it can act on — see the status table in maap.ts. */
const failure = (error: unknown) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: error instanceof MaapError || error instanceof Error ? error.message : 'The request failed.',
    },
  ],
})

const server = new McpServer({ name: 'maap', version: '0.1.0' })

server.registerTool(
  'list_targets',
  {
    description:
      'Search the maap catalogue of trained targets. A target is one specific number the model can ' +
      'predict, named by id. Call this FIRST to find the id to pass to `estimate`; ids cannot be ' +
      'guessed. Filter by keyword and by kind of number.',
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe('Keyword matched against the id and the description, e.g. "price", "pollution", "rings".'),
      primitive: z
        .enum(['amount', 'count', 'measure'])
        .optional()
        .describe('amount = money-like, count = whole numbers, measure = a reading on a scale.'),
      limit: z.number().int().min(1).max(200).default(25).describe('How many to return.'),
    }),
  },
  async (input) => {
    try {
      const all = await listTargets(readConfig(process.env))
      const needle = input.query?.trim().toLowerCase()
      const matched = all.filter(
        (target) =>
          (input.primitive === undefined || target.primitive === input.primitive) &&
          (!needle || `${target.id} ${target.description}`.toLowerCase().includes(needle)),
      )
      return {
        content: [{ type: 'text' as const, text: formatTargets(matched.slice(0, input.limit), matched.length) }],
      }
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'estimate',
  {
    description:
      'Estimate a number for one case, with calibrated uncertainty. Returns a median (the answer), an ' +
      '80% range the true value should fall inside about 80 times in 100, the quantiles you asked for, ' +
      'and the probability of crossing any threshold you name. Use the median as the answer, and the ' +
      'range when the decision depends on how wrong it could be. Needs a `target` id from ' +
      '`list_targets`. The first call after an idle period can take tens of seconds.',
    inputSchema: z.object({
      target: z
        .string()
        .min(1)
        .describe('A target id from list_targets, e.g. "uci_1.rings" or "kgl_flight_price_prediction.price".'),
      state: stateSchema,
      levels: z
        .array(level)
        .max(LIMITS.levels)
        .optional()
        .describe('Quantile levels in (0, 1). Default 0.1, 0.5, 0.9.'),
      interval_levels: z
        .array(level)
        .max(LIMITS.levels)
        .optional()
        .describe('Coverage levels for ranges, e.g. [0.5, 0.8]. Default 0.8.'),
      thresholds: z
        .array(z.number())
        .max(LIMITS.levels)
        .optional()
        .describe(
          'Numbers to test crossing. Returns P(value > t) for each — use this rather than comparing the median yourself.',
        ),
      return_pmf: z
        .boolean()
        .optional()
        .describe('Count targets only: the probability of each individual value.'),
      examples: z
        .array(z.object({ state: stateSchema, value: z.number() }))
        .max(LIMITS.examples)
        .optional()
        .describe(
          `Past cases with their known answers, up to ${LIMITS.examples}. Required (at least 8) for a target that is not in the catalogue.`,
        ),
    }),
  },
  async (input) => {
    try {
      const response = await runEstimate(readConfig(process.env), {
        state: input.state,
        questions: {
          [QUESTION_KEY]: {
            type: 'estimate',
            target: input.target,
            ...(input.levels && { levels: input.levels }),
            ...(input.interval_levels && { interval_levels: input.interval_levels }),
            ...(input.thresholds && { thresholds: input.thresholds }),
            ...(input.return_pmf && { return_pmf: true }),
            ...(input.examples && { examples: input.examples }),
          },
        },
      })

      const answer = response.questions[QUESTION_KEY]
      if (!answer) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'The API answered without an estimate.' }],
        }
      }

      return {
        content: [
          { type: 'text' as const, text: formatAnswer(input.target, answer, response.usage) },
          { type: 'text' as const, text: JSON.stringify(answer) },
        ],
      }
    } catch (error) {
      return failure(error)
    }
  },
)

await server.connect(new StdioServerTransport())
