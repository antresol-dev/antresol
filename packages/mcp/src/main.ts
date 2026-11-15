import os from 'node:os'
import { openPostgresStorage, createNeonHttpExecutor } from '@antresol/storage-postgres'
import type { InventoryStorage } from '@antresol/core'
import { createFileStore } from '@antresol/kit'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readConfig } from './config'
import type { ToolContext } from './context'
import { scrub, secretsOf } from './errors'
import { ACTOR_FALLBACK, createServer } from './server'
import { createSource, type Source } from './source'

async function main(): Promise<void> {
  const config = readConfig(process.env, process.platform, os.homedir())
  let storage: InventoryStorage | null = null
  let source: Source | null = null
  let openError: unknown
  if (config.connection) {
    try {
      storage = (await openPostgresStorage(createNeonHttpExecutor(config.connection.connectionString))).storage
      source = createSource(storage)
    } catch (e) {
      // The process stays up: every tool answers with this error.
      openError = e
    }
  }
  const ctx: ToolContext = {
    source,
    storage,
    config,
    actor: () => ({ device: ACTOR_FALLBACK }),
    files: config.connection ? createFileStore(config.connection) : null,
    now: () => new Date(),
    openError,
  }
  await createServer(ctx).connect(new StdioServerTransport())
}

main().catch((e: unknown) => {
  // stdout is the protocol: errors go to stderr.
  const config = readConfig(process.env, process.platform, os.homedir())
  console.error(scrub(e instanceof Error ? e.message : String(e), secretsOf(config)))
  process.exit(1)
})
