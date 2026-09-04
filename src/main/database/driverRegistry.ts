// Driver registry — the single entry point for creating driver sessions.
// Adding a new engine = implementing DatabaseDriver + registering here.

import type {
  DatabaseDriverRegistry,
  DriverConnectOptions,
  DriverFactory,
  DriverSession
} from './DatabaseDriver'
import { PostgresDriverSession } from './PostgresDriver'
import { createSshTunnel } from './ssh'
import type { ConnectionTestResult } from '@shared/models/connection'

export const driverRegistry: DatabaseDriverRegistry = {
  forEngine(engine: 'postgresql'): DriverFactory {
    if (engine !== 'postgresql') {
      throw new Error(`Unsupported engine: ${engine}`)
    }
    return {
      engine: 'postgresql',
      async test(options: DriverConnectOptions): Promise<ConnectionTestResult> {
        const password = await options.secretProvider()
        const tunnel = options.connection.config.ssh?.enabled
          ? await createTunnelSafe(options)
          : undefined
        const session = new PostgresDriverSession(options.connection, password ?? null, tunnel)
        try {
          const probe = await session.probe()
          if (probe.ok) {
            return {
              ok: true,
              latencyMs: probe.latencyMs,
              serverVersion: probe.serverVersion,
              connectedDatabase: options.connection.config.database
            }
          }
          return { ok: false, error: probe.error }
        } finally {
          await session.dispose()
        }
      },
      async connect(options: DriverConnectOptions): Promise<DriverSession> {
        const password = await options.secretProvider()
        const tunnel = options.connection.config.ssh?.enabled
          ? await createTunnelSafe(options)
          : undefined
        const session = new PostgresDriverSession(options.connection, password ?? null, tunnel)
        const probe = await session.probe()
        if (!probe.ok) {
          await session.dispose()
          throw new Error(probe.error?.message ?? 'Connection failed.')
        }
        return session
      }
    }
  }
}

async function createTunnelSafe(options: DriverConnectOptions) {
  const sshConfig = options.connection.config.ssh!
  return createSshTunnel(
    sshConfig,
    options.connection.config.host,
    options.connection.config.port,
    options.secretProvider
  )
}