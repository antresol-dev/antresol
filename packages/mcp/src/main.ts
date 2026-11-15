import os from 'node:os'
import { openPostgresStorage, createNeonHttpExecutor } from '@antresol/storage-postgres'
import { createFileStore } from '@antresol/kit'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readConfig } from './config'
import { ensureOpen, type ToolContext } from './context'
import { scrub, secretsOf } from './errors'
import { ACTOR_FALLBACK, createServer } from './server'

const openStorage = (connectionString: string) => async () => (await openPostgresStorage(createNeonHttpExecutor(connectionString))).storage

async function main(): Promise<void> {
  const config = readConfig(process.env, process.platform, os.homedir())
  const ctx: ToolContext = {
    source: null,
    storage: null,
    config,
    actor: () => ({ device: ACTOR_FALLBACK }),
    files: config.connection ? createFileStore(config.connection) : null,
    now: () => new Date(),
    openStorage: config.connection ? openStorage(config.connection.connectionString) : undefined,
  }
  // A failed open is not fatal: the process stays up and later calls retry it (see ensureOpen).
  await ensureOpen(ctx)
  await createServer(ctx).connect(new StdioServerTransport())
}

main().catch((e: unknown) => {
  // stdout is the protocol: errors go to stderr.
  const config = readConfig(process.env, process.platform, os.homedir())
  console.error(scrub(e instanceof Error ? e.message : String(e), secretsOf(config)))
  process.exit(1)
})
