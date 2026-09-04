// Streaming result export. Reads pages from an open cursor session and writes
// CSV / TSV / JSON directly to disk — the result is never materialized in
// memory beyond one page at a time.

import { createWriteStream, type WriteStream } from 'node:fs'
import type { QueryColumn, ExportRequest, ExportResult } from '@shared/models/result'

export interface CursorPageProvider {
  columns: QueryColumn[]
  fetchNextPage(maxRows: number): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean }>
}

export async function streamExport(
  provider: CursorPageProvider,
  request: ExportRequest
): Promise<ExportResult> {
  const startedAt = Date.now()
  const stream = createWriteStream(request.filePath, { flags: 'w', encoding: 'utf8' })

  const pageSize = 1000
  let rows = 0
  let bytes = 0
  let hasMore = true

  const encode = encoderFor(request.format)

  try {
    if (request.format === 'json') {
      await write(stream, '[\n')
    } else {
      await write(stream, encode.header(provider.columns))
    }

    let first = true
    while (hasMore) {
      const page = await provider.fetchNextPage(pageSize)
      for (const row of page.rows) {
        const chunk = encode.row(row, provider.columns, first)
        if (request.format === 'json' && !first) {
          bytes += await write(stream, ',\n' + chunk)
        } else {
          bytes += await write(stream, chunk)
        }
        rows++
        first = false
      }
      hasMore = page.hasMore
    }

    if (request.format === 'json') {
      bytes += await write(stream, '\n]\n')
    }
  } finally {
    await closeStream(stream)
  }

  return { rows, bytes, durationMs: Date.now() - startedAt }
}

function encoderFor(format: ExportRequest['format']) {
  if (format === 'json') {
    return {
      header: (_cols: QueryColumn[]): string => '',
      row: (row: Record<string, unknown>, _cols: QueryColumn[], _first: boolean): string =>
        JSON.stringify(row, (k, v) => (k === '__rowId' ? undefined : v))
    }
  }
  const isCsv = format === 'csv'
  const sep = isCsv ? ',' : '\t'

  return {
    header(cols: QueryColumn[]): string {
      return cols
        .map((c, i) => (i > 0 ? sep : '') + quote(c.name, isCsv, sep))
        .join('') + '\n'
    },
    row(row: Record<string, unknown>, cols: QueryColumn[], _first: boolean): string {
      const parts = cols.map((c, i) => {
        const value = row[c.name]
        if (value === null || value === undefined) return 'NULL'
        return quote(formatValue(value), isCsv, sep)
      })
      return parts.join(sep) + '\n'
    }
  }
}

function quote(value: string, csv: boolean, sep: string): string {
  if (!csv) return value.includes(sep) || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function write(stream: WriteStream, chunk: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (chunk.length === 0) return resolve(0)
    stream.write(chunk, (err) => (err ? reject(err) : resolve(Buffer.byteLength(chunk))))
  })
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject)
    stream.end(() => resolve())
  })
}