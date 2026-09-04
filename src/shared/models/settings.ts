export type ThemeName = 'dark' | 'light'

export type KeywordCase = 'upper' | 'lower' | 'preserve'

export interface FormattingSettings {
  indent: string
  keywordCase: KeywordCase
  linesBetweenQueries: number
}

export interface ProtectionSettings {
  /** show a confirmation dialog before dangerous statements (DROP/TRUNCATE/DELETE-no-where) */
  confirmDangerous: boolean
  /** when true, DROP/TRUNCATE are blocked entirely for non-production connections too */
  blockDestructiveDDL: boolean
}

export interface ResultSettings {
  pageSize: number
  /** results keep at most this many loaded pages in the grid */
  maxLoadedRows: number
  fetchMoreThreshold: number
}

export interface EditorSettings {
  fontSize: number
  tabSize: number
  /** when false, results are read-only for ALL connections */
  allowResultEditing: boolean
}

export interface AppSettings {
  version: number
  theme: ThemeName
  formatting: FormattingSettings
  protection: ProtectionSettings
  results: ResultSettings
  editor: EditorSettings
  /** last-active connection shown in the sidebar */
  lastActiveConnectionId?: string
  /** sidebar section widths (px) */
  layout: {
    sidebarWidth: number
    explorerWidth: number
    editorResultSplit: number
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  theme: 'dark',
  formatting: { indent: '    ', keywordCase: 'upper', linesBetweenQueries: 2 },
  protection: { confirmDangerous: true, blockDestructiveDDL: false },
  results: { pageSize: 500, maxLoadedRows: 500_000, fetchMoreThreshold: 200 },
  editor: { fontSize: 13, tabSize: 4, allowResultEditing: true },
  layout: { sidebarWidth: 300, explorerWidth: 280, editorResultSplit: 55 }
}