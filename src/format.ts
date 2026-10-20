import type { Answer, Target, Usage } from './maap'

/**
 * An answer, rendered for something that reads text.
 *
 * The console draws a band chart; an agent gets the same facts as lines it can quote. The
 * ORDER is the point: the median first because that is the answer, the interval second
 * because that is the honest version of it, and the calibration line last because it says how
 * much to trust the two above.
 */
const percent = (p: number): string => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`

const withUnit = (value: number, unit: string | null | undefined): string =>
  unit ? `${value} ${unit}` : `${value}`

const pairs = (map: Record<string, number>, render: (key: string, value: number) => string): string =>
  Object.entries(map)
    .map(([key, value]) => render(key, value))
    .join(', ')

export const formatAnswer = (target: string, answer: Answer, usage?: Usage): string => {
  const lines = [
    `${target} (${answer.primitive})`,
    `median: ${withUnit(answer.median, answer.unit)}`,
  ]

  if (answer.interval80) {
    lines.push(
      `80% range: ${answer.interval80[0]} – ${answer.interval80[1]}${answer.unit ? ` ${answer.unit}` : ''}` +
        ' (about 80 of 100 cases like this land inside)',
    )
  }

  const otherIntervals = Object.entries(answer.intervals ?? {}).filter(([level]) => level !== '0.8')
  if (otherIntervals.length > 0) {
    lines.push(
      `intervals: ${otherIntervals.map(([level, range]) => `${level} → ${range[0]} – ${range[1]}`).join(', ')}`,
    )
  }

  if (answer.quantiles) {
    lines.push(`quantiles: ${pairs(answer.quantiles, (level, value) => `${level} → ${value}`)}`)
  }

  if (answer.prob_over) {
    lines.push(
      `thresholds: ${pairs(answer.prob_over, (at, p) => `P(value > ${at}) = ${percent(p)}`)}`,
    )
  }

  if (answer.pmf) {
    const entries = Object.entries(answer.pmf).slice(0, 12)
    const more = Object.keys(answer.pmf).length - entries.length
    lines.push(
      `pmf: ${entries.map(([value, p]) => `${value} → ${percent(p)}`).join(', ')}` +
        (more > 0 ? ` (+${more} more values)` : ''),
    )
  } else if (answer.pmf_note) {
    lines.push(`pmf: not returned — ${answer.pmf_note}`)
  }

  /* Reported, never recommended: on a skewed target the mean sits outside the interval above,
     so it travels with the reason not to use it. */
  if (answer.mean !== null && answer.mean !== undefined) {
    lines.push(`mean: ${answer.mean} — prefer the median; ${answer.mean_warning ?? 'the mean is pulled by rare large outcomes'}`)
  }

  const trust = [
    `regime ${answer.regime}`,
    `calibration ${answer.calibration ?? 'unknown'}${answer.calibration_rule ? ` (${answer.calibration_rule})` : ''}`,
    answer.k === null || answer.k === undefined ? null : `k ${answer.k}`,
    usage?.compute_ms === undefined ? null : `${usage.compute_ms} ms`,
  ].filter(Boolean)
  lines.push(trust.join(' · '))

  if (answer.calibration === 'none') {
    lines.push(
      'NOTE: no calibration map was applied to this target, so the range carries no coverage promise.',
    )
  }
  if (answer.novelty_flag) {
    lines.push('NOTE: this case sits outside the training cover. Treat the range as indicative.')
  }
  if (answer.warning) lines.push(`WARNING: ${answer.warning}`)

  return lines.join('\n')
}

/** The catalogue, as a table an agent can pick an id out of. */
export const formatTargets = (targets: Target[], total: number): string => {
  if (targets.length === 0) {
    return 'No targets matched. Call list_targets with no query to see what the catalogue holds.'
  }

  const rows = targets.map(
    (target) =>
      `${target.id}  [${target.primitive}${target.unit ? `, ${target.unit}` : ''}]  ${target.description}`,
  )
  const shown = targets.length < total ? `Showing ${targets.length} of ${total} matches.` : `${total} matches.`
  return [shown, ...rows].join('\n')
}
