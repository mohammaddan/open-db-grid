export type ThemeName =
  | 'cyber-dark'
  | 'midnight-sapphire'
  | 'linear-titanium'
  | 'amber-carbon'
  | 'emerald-matrix'
  | 'dracula-amethyst'
  | 'nordic-frost'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'gruvbox-dark'
  | 'solarized-dark'
  | 'monokai-pro'
  | 'github-dark'
  | 'rose-pine-dawn'
  | 'solarized-light'
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
    id: 'tokyo-night',
    name: 'Tokyo Night',
    category: 'Dark',
    accentColor: '#7aa2f7',
    secondaryAccent: '#bb9af7',
    previewBg: '#1a1b26',
    description: 'Sleek Tokyo nightscapes with cool indigo slate, neon cyan, electric blue, and purple.'
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    category: 'Dark',
    accentColor: '#cba6f7',
    secondaryAccent: '#89b4fa',
    previewBg: '#1e1e2e',
    description: 'Soothing pastel mocha palette with velvety mauve, lavender, peach, and soft teal accents.'
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
    id: 'monokai-pro',
    name: 'Monokai Pro',
    category: 'Dark',
    accentColor: '#ffd866',
    secondaryAccent: '#ff6188',
    previewBg: '#221f22',
    description: 'Sleek matte charcoal with vibrant Monokai spectrum yellow, pink, mint, and cyan.'
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
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    category: 'Dark',
    accentColor: '#fe8019',
    secondaryAccent: '#fabd2f',
    previewBg: '#282828',
    description: 'Warm retro groove with rich earthy charcoal, bright amber orange, forest olive, and gold.'
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
    id: 'solarized-dark',
    name: 'Solarized Dark',
    category: 'Dark',
    accentColor: '#2aa198',
    secondaryAccent: '#268bd2',
    previewBg: '#002b36',
    description: 'Timeless optical-engineered solarized palette with deep cyan-teal and amber highlights.'
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
    id: 'amber-carbon',
    name: 'Amber Carbon',
    category: 'Dark',
    accentColor: '#f59e0b',
    secondaryAccent: '#fbbf24',
    previewBg: '#141416',
    description: 'Warm carbon charcoal slate with radiant amber gold and brass highlights.'
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    category: 'Dark',
    accentColor: '#58a6ff',
    secondaryAccent: '#bc8cff',
    previewBg: '#0d1117',
    description: 'Crisp GitHub-inspired developer dark slate with vivid blue, green, and coral highlights.'
  },
  {
    id: 'light',
    name: 'Clean Light',
    category: 'Light',
    accentColor: '#0284c7',
    secondaryAccent: '#7c3aed',
    previewBg: '#f8fafc',
    description: 'Ultra-crisp high-contrast daylight theme with azure blue accents.'
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    category: 'Light',
    accentColor: '#d7827e',
    secondaryAccent: '#907aa9',
    previewBg: '#faf4ed',
    description: 'Warm, cozy parchment daylight theme with soft rose, pine teal, iris, and gold hues.'
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    category: 'Light',
    accentColor: '#268bd2',
    secondaryAccent: '#2aa198',
    previewBg: '#fdf6e3',
    description: 'Precision-engineered solarized daylight palette with warm ivory paper, azure, and cyan.'
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