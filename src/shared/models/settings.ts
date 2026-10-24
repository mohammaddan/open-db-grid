export type ThemeName =
  | 'cyber-dark'
  | 'midnight-sapphire'
  | 'linear-titanium'
  | 'amber-carbon'
  | 'emerald-matrix'
  | 'dracula-amethyst'
  | 'nordic-frost'
  | 'light'
  | 'dark'

export interface ThemeDefinition {
  id: ThemeName
  name: string
  category: 'Dark' | 'Light'
  accentColor: string
  secondaryAccent: string
  previewBg: string
  description: string
}

export const AVAILABLE_THEMES: ThemeDefinition[] = [
  {
    id: 'cyber-dark',
    name: 'Obsidian Cyber',
    category: 'Dark',
    accentColor: '#06b6d4',
    secondaryAccent: '#8b5cf6',
    previewBg: '#0b0f17',
    description: 'Deep obsidian space slate with neon electric cyan and vivid violet accents.'
  },
  {
    id: 'midnight-sapphire',
    name: 'Midnight Sapphire',
    category: 'Dark',
    accentColor: '#38bdf8',
    secondaryAccent: '#3b82f6',
    previewBg: '#070d1a',
    description: 'Deep oceanic midnight navy with luminous sapphire blue and sky highlights.'
  },
  {
    id: 'linear-titanium',
    name: 'Linear Titanium',
    category: 'Dark',
    accentColor: '#10b981',
    secondaryAccent: '#6366f1',
    previewBg: '#121316',
    description: 'Minimalist matte titanium graphite with emerald green and cool steel accents.'
  },
  {
    id: 'amber-carbon',
    name: 'Amber Carbon',
    category: 'Dark',
    accentColor: '#f59e0b',
    secondaryAccent: '#fbbf24',
    previewBg: '#141416',
    description: 'Warm carbon charcoal slate with radiant amber gold and brass highlights.'
  },
  {
    id: 'emerald-matrix',
    name: 'Emerald Matrix',
    category: 'Dark',
    accentColor: '#00e676',
    secondaryAccent: '#10b981',
    previewBg: '#07100d',
    description: 'High-contrast cyber matrix dark with vivid fluorescent emerald highlights.'
  },
  {
    id: 'dracula-amethyst',
    name: 'Dracula Amethyst',
    category: 'Dark',
    accentColor: '#e879f9',
    secondaryAccent: '#a855f7',
    previewBg: '#13111c',
    description: 'Gothic deep amethyst purple night with vibrant orchid magenta and lilac.'
  },
  {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    category: 'Dark',
    accentColor: '#88c0d0',
    secondaryAccent: '#81a1c1',
    previewBg: '#14171e',
    description: 'Arctic glacial slate with crystalline frosty cyan and polar blue tones.'
  },
  {
    id: 'light',
    name: 'Clean Light',
    category: 'Light',
    accentColor: '#0284c7',
    secondaryAccent: '#7c3aed',
    previewBg: '#f8fafc',
    description: 'Ultra-crisp high-contrast daylight theme with azure blue accents.'
  }
]

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