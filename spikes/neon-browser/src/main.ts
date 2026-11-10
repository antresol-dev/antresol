import { newId, type Actor, type InventoryStorage } from '@graymatter/core'
import {
  assertTestDatabase,
  createNeonHttpExecutor,
  createNeonWsExecutor,
  openPostgresStorage,
  type PgExecutor,
} from '@graymatter/storage-postgres'
import { neon, neonConfig, Pool, type PoolClient } from '@neondatabase/serverless'

type StepResult = { scenario: string; step: string; ms: number; ok: boolean; error?: string }
type Step = [name: string, run: () => Promise<unknown>]

const urlInput = document.getElementById('url') as HTMLInputElement
const runButton = document.getElementById('run') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement
const tbody = document.getElementById('results') as HTMLElement
;(document.getElementById('ua') as HTMLElement).textContent = navigator.userAgent

const actor: Actor = { device: `Spike · ${/Android/.test(navigator.userAgent) ? 'Android' : 'Desktop'}` }
let results: StepResult[] = []

// The connection string lives only in this page's memory; the dev server may prefill the test DB URL
// when the page was opened with the token it prints (?k=…).
fetch(`/__spike/prefill?k=${encodeURIComponent(new URLSearchParams(location.search).get('k') ?? '')}`)
  .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : null))
  .then((d) => {
    if (d?.url && !urlInput.value) {
      urlInput.value = d.url
      statusEl.textContent = 'Test database URL prefilled by the dev server.'
    }
  })
  .catch(() => {})

function record(r: StepResult) {
  results.push(r)
  const tr = document.createElement('tr')
  tr.className = r.ok ? 'ok' : 'fail'
  for (const text of [r.scenario, r.step, r.ok ? `${Math.round(r.ms)} ms` : 'FAILED', r.error ?? '']) {
    const td = document.createElement('td')
    td.textContent = text
    tr.append(td)
  }
  tbody.append(tr)
}

// Runs steps in order; the first failure ends the scenario because later steps depend on it.
async function scenario(name: string, steps: Step[]) {
  for (const [step, run] of steps) {
    const t0 = performance.now()
    try {
      await run()
      record({ scenario: name, step, ms: performance.now() - t0, ok: true })
    } catch (e) {
      record({ scenario: name, step, ms: performance.now() - t0, ok: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
  }
}

async function httpRaw(url: string) {
  const sql = neon(url, { disableWarningInBrowsers: true })
  const a = newId()
  const b = newId()
  await scenario('HTTP raw', [
    ['select 1 (first)', () => sql`select 1`],
    ['select 1 (again)', () => sql`select 1`],
    ['create table', () => sql`create table if not exists gm_spike (id uuid primary key, note text)`],
    ['transaction: 2 inserts', () =>
      sql.transaction([
        sql`insert into gm_spike values (${a}, 'http a')`,
        sql`insert into gm_spike values (${b}, 'http b')`,
      ])],
    ['select count(*)', () => sql`select count(*) from gm_spike`],
    ['delete', () => sql`delete from gm_spike where id in (${a}, ${b})`],
  ])
}

async function wsRaw(url: string) {
  neonConfig.disableWarningInBrowsers = true
  const pool = new Pool({ connectionString: url })
  let client: PoolClient | undefined
  const q = (text: string, params: unknown[] = []) => () => client!.query(text, params)
  try {
    await scenario('WebSocket raw', [
      ['connect', async () => { client = await pool.connect() }],
      ['select 1', q('select 1')],
      ['create table', q('create table if not exists gm_spike (id uuid primary key, note text)')],
      ['BEGIN', q('BEGIN')],
      ['insert a', q('insert into gm_spike values ($1, $2)', [newId(), 'ws a'])],
      ['insert b', q('insert into gm_spike values ($1, $2)', [newId(), 'ws b'])],
      ['COMMIT', q('COMMIT')],
      ['select count(*)', q('select count(*) from gm_spike')],
      ['drop table', q('drop table gm_spike')],
    ])
  } finally {
    client?.release()
    await pool.end().catch(() => {})
  }
}

// The real stack Plan 2 will use: migrator over import.meta.glob, one-batch commands, snapshot load.
async function storageStack(label: string, make: (url: string) => PgExecutor, url: string) {
  const exec = make(url)
  const inventoryId = newId()
  let storage: InventoryStorage | undefined
  try {
    await scenario(`GrayMatter storage (${label})`, [
      ['open (migrate / check schema)', async () => { storage = (await openPostgresStorage(exec)).storage }],
      ['apply inventory.create', () =>
        storage!.apply({ type: 'inventory.create', id: inventoryId, name: `Spike ${label}`, description: null, currency: 'USD' }, actor)],
      ['listInventories', () => storage!.listInventories()],
      ['loadInventory', () => storage!.loadInventory(inventoryId)],
    ])
  } finally {
    await exec.close().catch(() => {})
  }
}

runButton.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  try {
    assertTestDatabase(url)
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e)
    return
  }
  runButton.disabled = true
  results = []
  tbody.replaceChildren()
  const startedAt = new Date().toISOString()
  statusEl.textContent = 'Running…'
  try {
    await httpRaw(url)
    await wsRaw(url)
    await storageStack('websocket', createNeonWsExecutor, url)
    await storageStack('http', createNeonHttpExecutor, url)
    const failed = results.filter((r) => !r.ok).length
    statusEl.textContent = failed ? `Done with ${failed} failed step(s).` : 'Done, all steps passed.'
    await fetch('/__spike/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startedAt, userAgent: navigator.userAgent, results }),
    }).then(
      (r) => { if (r.ok) statusEl.textContent += ' Results sent to the dev server.' },
      () => {},
    )
  } finally {
    runButton.disabled = false
  }
})
