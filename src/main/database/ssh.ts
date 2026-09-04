// SSH tunnel support for database connections.
//
// Uses ssh2 (pure JS) to open a forwarded stream to the database host/port,
// then exposes it through a local TCP server (127.0.0.1:0) that PostgreSQL
// clients connect to. No passwords are logged anywhere.

import type { SshTunnelConfig } from '@shared/models/connection'
import { Client as SshClient, type ConnectConfig } from 'ssh2'
import { createServer, type Server } from 'node:net'
import { readFile } from 'node:fs/promises'
import { DatabaseError } from './errors'

export interface TunnelHandle {
  readonly host: string
  readonly port: number
  close(): Promise<void>
}

export async function createSshTunnel(
  tunnelConfig: SshTunnelConfig,
  dbHost: string,
  dbPort: number,
  secretProvider: () => Promise<string | null>
): Promise<TunnelHandle> {
  const connectConfig = await buildConnectConfig(tunnelConfig, secretProvider)

  const ssh = new SshClient()

  const netServer = await new Promise<Server>((resolve, reject) => {
    const srv = createServer((socket) => {
      ssh.forwardOut('127.0.0.1', 0, dbHost, dbPort, (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        stream.on('error', () => socket.destroy())
        socket.on('error', () => stream.end())
        socket.pipe(stream).pipe(socket)
      })
    })
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      srv.removeListener('error', reject)
      resolve(srv)
    })
  })

  await new Promise<void>((resolve, reject) => {
    ssh.once('error', reject)
    ssh.once('ready', () => {
      ssh.removeListener('error', reject)
      resolve()
    })
    ssh.connect(connectConfig)
  })

  const address = netServer.address()
  const port = typeof address === 'object' && address ? address.port : 0
  if (!port) {
    netServer.close()
    ssh.end()
    throw new DatabaseError({ message: 'Could not bind local SSH tunnel port.' })
  }

  return {
    host: '127.0.0.1',
    port,
    close() {
      return new Promise((resolve) => {
        netServer.close(() => resolve())
        ssh.end()
      })
    }
  }
}

async function buildConnectConfig(
  t: SshTunnelConfig,
  secretProvider: () => Promise<string | null>
): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: t.host,
    port: t.port,
    username: t.username,
    readyTimeout: 15000,
    keepaliveInterval: 10_000
  }
  if (t.authType === 'password') {
    let password = t.password
    if (!password) password = (await secretProvider()) ?? undefined
    return { ...base, password }
  }
  if (t.privateKeyPath) {
    try {
      const privateKey = await readFile(t.privateKeyPath, 'utf8')
      return {
        ...base,
        privateKey,
        passphrase: t.passphrase || undefined
      }
    } catch {
      throw new DatabaseError({
        message: `Could not read SSH private key at "${t.privateKeyPath}".`
      })
    }
  }
  throw new DatabaseError({ message: 'SSH tunnel requires either a password or a private key.' })
}