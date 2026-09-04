// TransactionService: BEGIN / COMMIT / ROLLBACK routed to the driver.
// Transactions are explicit user actions — nothing is committed silently.

import type { TransactionStatus, BeginTransactionResult } from '@shared/models/transactions'
import { ConnectionService } from './ConnectionService'
import { toQueryErrorInfo, DatabaseError } from '@main/database/errors'

export class TransactionService {
  constructor(private readonly connections: ConnectionService) {}

  async status(connectionId: string): Promise<TransactionStatus> {
    const session = this.connections.getSession(connectionId)
    return session.txnStatus()
  }

  private async run(
    connectionId: string,
    op: 'begin' | 'commit' | 'rollback'
  ): Promise<BeginTransactionResult> {
    try {
      const session = this.connections.getSession(connectionId)
      if (op === 'begin') await session.begin()
      else if (op === 'commit') await session.commit()
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