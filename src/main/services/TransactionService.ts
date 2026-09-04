// TransactionService: BEGIN / COMMIT / ROLLBACK routed to the driver.
// Transactions are explicit user actions — nothing is committed silently.

import type { TransactionStatus, BeginTransactionResult } from '@shared/models/transactions'
import { ConnectionService } from './ConnectionService'
import { toQueryErrorInfo, DatabaseError } from '@main/database/errors'

export class TransactionService {
  constructor(private readonly connections: ConnectionService) {}

  async status(connectionId: string): Promise<TransactionStatus> {
    if (!this.connections.isOpen(connectionId)) {
      return { connectionId, state: 'none' }
    }
    const session = this.connections.getSession(connectionId)
    return session.txnStatus()
  }

  private async run(
    connectionId: string,
    op: 'begin' | 'commit' | 'rollback'
  ): Promise<BeginTransactionResult> {
    try {
      if (op === 'begin') {
        // explicit user action on a connection — open it on demand
        const session = await this.connections.ensureSession(connectionId)
        await session.begin()
        return { ok: true }
      }
      if (!this.connections.isOpen(connectionId)) {
        return {
          ok: false,
          error: { message: `Connection is not open — there is no transaction to ${op}.` }
        }
      }
      const session = this.connections.getSession(connectionId)
      if (op === 'commit') await session.commit()
      else await session.rollback()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: toQueryErrorInfo(err) }
    }
  }

  begin(connectionId: string): Promise<BeginTransactionResult> {
    return this.run(connectionId, 'begin')
  }
  commit(connectionId: string): Promise<BeginTransactionResult> {
    return this.run(connectionId, 'commit')
  }
  rollback(connectionId: string): Promise<BeginTransactionResult> {
    return this.run(connectionId, 'rollback')
  }
}

export { DatabaseError }