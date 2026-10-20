# maap-mcp

maap over MCP: ask for a number, get a calibrated distribution — a median, the range the true
value should fall inside, and the probability of crossing a threshold you name.

Two tools:

| Tool | Does |
|---|---|
| `list_targets` | Search the 104 trained targets. Call this first — a target id is not guessable |
| `estimate` | One case, one target → median, quantiles, intervals, `P(value > t)`, and how calibrated the answer is |

## Install

Get a key at [dash.hitl.systems/keys](https://dash.hitl.systems/keys), then add the server to
your client.

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "maap": {
      "command": "npx",
      "args": ["-y", "maap-mcp"],
      "env": { "MAAP_API_KEY": "apikey_..." }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add maap --env MAAP_API_KEY=apikey_... -- npx -y maap-mcp
```

Not on npm yet — until it is, install straight from this repo by swapping `maap-mcp` for
`github:hitl-systems/maap-mcp` in any of the above. The built bundle is committed, so there is
nothing to compile.

**Cursor** — `~/.cursor/mcp.json`: the same `mcpServers` block as Claude Desktop.

| Variable | Required | Default |
|---|---|---|
| `MAAP_API_KEY` | yes | — |
| `MAAP_BASE_URL` | no | `https://dash.hitl.systems` |

## Using it

> Which maap target predicts flight prices? Estimate the fare for a Vistara economy ticket
> Delhi → Mumbai, non-stop, booked 9 days out, and tell me the chance it is over ₹10,000.

The agent calls `list_targets` for the id, then `estimate` with your case as the `state`.

**Read the median as the answer and the range as what to plan against.** For a threshold
question, pass `thresholds` and read `P(value > t)` — do not compare the median to the
threshold yourself; the median says where the middle is, not how likely the threshold is.

An answer also carries how much to trust it: `regime` (`in_domain`, or `new_target` when the
model only knows what your examples taught it), `calibration` (`"none"` means no correction
survived its check, so the range carries no coverage promise), and `novelty_flag` when the case
is unlike anything in training. Known limits are published:
[dash.hitl.systems/docs/calibration](https://dash.hitl.systems/docs/calibration).

## Notes

- One question per call. The HTTP API takes up to 32 under names you choose; a flat tool is the
  one an agent fills in correctly.
- The first call after an idle period starts a GPU container and can take tens of seconds. The
  server waits 120 s and tells the agent to retry rather than failing silently.
- Each question counts against your allowance. A rejected call costs nothing.
- Pricing, limits and the full wire format: [dash.hitl.systems/docs/api](https://dash.hitl.systems/docs/api).

MIT.
