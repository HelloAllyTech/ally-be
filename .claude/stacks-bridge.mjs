#!/usr/bin/env node
/**
 * Stacks MCP bridge — stdio in, Streamable HTTP out.
 *
 * Canonical copy. Every Ally repo commits this file at `.claude/stacks-bridge.mjs`
 * and points its `.mcp.json` at it; a change here has to be copied out to all of
 * them, and nothing fails loudly if it isn't. It lives here rather than only in the
 * consuming repos because it is half of a contract with `/api/mcp/exchange`, and a
 * client with no home in the server's repo drifts silently.
 *
 * WHY A BRIDGE AT ALL
 *
 * `.mcp.json` can expand `${ENV_VAR}` but cannot run a command, so an HTTP server
 * declaration can only carry a credential that already exists in the environment.
 * That leaves two ways to get zero-setup: commit a key (impossible — four of the
 * seven Ally repos are public), or run a process that can *obtain* one. This is
 * that process. It speaks MCP over stdio to Claude Code and forwards every message
 * to the HTTP endpoint with a key it resolves at startup.
 *
 * CREDENTIAL RESOLUTION, in order:
 *
 *   1. `STACKS_API_KEY` in the environment — an engineer who already set one keeps
 *      working, and CI can inject one without touching GitHub.
 *   2. `~/.claude/.stacks-key` — the cache, mode 0600.
 *   3. `gh auth token` → POST /api/mcp/exchange → cache it.
 *
 * Step 3 sends the engineer's GitHub token to the Stacks server, which uses it to
 * confirm org membership and then drops it. Because step 2 short-circuits, that
 * happens **once per machine**, not once per session.
 *
 * FAILURE POSTURE — the opposite of the hook this replaced. That hook failed open
 * and silent, which meant a session with no context looked exactly like a library
 * with nothing to say. A bridge cannot do that: if it cannot get a key there is no
 * server, so it exits with a message naming the fix. Silence here would produce a
 * session that has quietly lost the library and does not know it.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

const ENDPOINT =
  process.env.STACKS_MCP_URL || 'https://product-management-rag-mcp-orcin.vercel.app/api/mcp'
const CACHE = join(homedir(), '.claude', '.stacks-key')

/** Diagnostics go to stderr: stdout is the JSON-RPC channel and must stay clean. */
const log = (msg) => process.stderr.write(`[stacks-bridge] ${msg}\n`)

function die(msg) {
  log(msg)
  process.exit(1)
}

function readCache() {
  try {
    const key = readFileSync(CACHE, 'utf8').trim()
    return key.startsWith('sk_stacks_') ? key : null
  } catch {
    return null
  }
}

function writeCache(key) {
  try {
    mkdirSync(dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, `${key}\n`, { mode: 0o600 })
    chmodSync(CACHE, 0o600) // explicit: writeFileSync's mode is ignored if the file existed
  } catch (e) {
    // Not fatal — we have a usable key, we just could not save it. The next
    // session will exchange again.
    log(`warning: could not write ${CACHE} (${e.message}); will re-exchange next time`)
  }
}

function githubToken() {
  // `gh` resolves its own auth (keyring, env, config) far more reliably than
  // guessing at GH_TOKEN ourselves.
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) return null
  return r.stdout.trim() || null
}

async function exchange() {
  const token = githubToken()
  if (!token) {
    die(
      'No Stacks key and no GitHub login to derive one from.\n' +
        '  Fix: run `gh auth login` (once per machine), then start a new session.\n' +
        '  Or:  set STACKS_API_KEY in your environment.',
    )
  }

  let res
  try {
    res = await fetch(`${ENDPOINT.replace(/\/api\/mcp$/, '')}/api/mcp/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_token: token, hostname: hostname() }),
    })
  } catch (e) {
    die(`Could not reach the Stacks server to get a key: ${e.message}`)
  }

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    die(
      `Stacks refused to issue a key (${res.status}): ${payload.error ?? 'no detail'}` +
        (payload.hint ? `\n  ${payload.hint}` : ''),
    )
  }
  if (!payload.key) die('Stacks returned no key.')

  log(`issued a key for ${payload.name}`)
  writeCache(payload.key)
  return payload.key
}

async function resolveKey() {
  if (process.env.STACKS_API_KEY) return process.env.STACKS_API_KEY
  return readCache() ?? (await exchange())
}

const KEY = await resolveKey()

/**
 * Forward one JSON-RPC message and return the server's reply, or null.
 *
 * Notifications (no `id`) expect no response, and the server answers them with an
 * empty 202. Writing anything to stdout for those would desynchronise the client.
 */
async function forward(message) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      // The endpoint is Streamable HTTP: it replies as SSE, so both are required.
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  })

  if (res.status === 401) {
    // The cached key was revoked or rotated. Nothing useful can follow, and a
    // silent stall would leave the session thinking the library is empty.
    die(
      'Stacks rejected the cached key (401). It was probably revoked.\n' +
        `  Fix: rm ${CACHE} and start a new session to get a fresh one.`,
    )
  }

  const text = await res.text()
  if (!text.trim()) return null

  // SSE frames the JSON-RPC envelope on `data:` lines; a plain JSON reply has none.
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .join('')
  return (data || text).trim() || null
}

const rl = createInterface({ input: process.stdin })

// Serialised deliberately. MCP over stdio permits concurrent in-flight requests,
// but this server is stateless per request and ordering bugs here would be
// miserable to diagnose from inside a session; retrieval is not throughput-bound.
let queue = Promise.resolve()

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    log(`ignoring unparseable line: ${trimmed.slice(0, 120)}`)
    return
  }

  queue = queue.then(async () => {
    try {
      const reply = await forward(message)
      if (reply) process.stdout.write(`${reply}\n`)
    } catch (e) {
      log(`request failed: ${e.message}`)
      // Answer the client rather than hanging it, but only where a reply is owed.
      if (message.id !== undefined && message.id !== null) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: `stacks-bridge: ${e.message}` },
          })}\n`,
        )
      }
    }
  })
})

rl.on('close', () => {
  queue.then(() => process.exit(0))
})
