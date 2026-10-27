import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AVAILABLE_THEMES } from '@shared/models/settings'

describe('Theme System', () => {
  it('contains expected number of themes with unique IDs', () => {
    expect(AVAILABLE_THEMES.length).toBeGreaterThanOrEqual(16)
    const ids = AVAILABLE_THEMES.map((t) => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('contains both Dark and Light themes', () => {
    const darkThemes = AVAILABLE_THEMES.filter((t) => t.category === 'Dark')
    const lightThemes = AVAILABLE_THEMES.filter((t) => t.category === 'Light')
    expect(darkThemes.length).toBeGreaterThanOrEqual(10)
    expect(lightThemes.length).toBeGreaterThanOrEqual(3)
  })

  it('has valid color codes and metadata for all themes', () => {
    for (const theme of AVAILABLE_THEMES) {
      expect(theme.name.trim().length).toBeGreaterThan(0)
      expect(theme.description.trim().length).toBeGreaterThan(0)
      expect(theme.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(theme.secondaryAccent).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(theme.previewBg).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('defines matching CSS rules in theme.css for every available theme', () => {
    const cssPath = resolve(__dirname, '../../src/renderer/src/styles/theme.css')
    const css = readFileSync(cssPath, 'utf-8')

    for (const theme of AVAILABLE_THEMES) {
      const selector = `[data-theme='${theme.id}']`
      expect(css).toContain(selector)
    }
  })

  it('includes core popular themes', () => {
    const ids = AVAILABLE_THEMES.map((t) => t.id)
    expect(ids).toContain('cyber-dark')
    expect(ids).toContain('tokyo-night')
    expect(ids).toContain('catppuccin-mocha')
    expect(ids).toContain('gruvbox-dark')
    expect(ids).toContain('solarized-dark')
    expect(ids).toContain('monokai-pro')
    expect(ids).toContain('github-dark')
    expect(ids).toContain('rose-pine-dawn')
    expect(ids).toContain('solarized-light')
    expect(ids).toContain('light')
  })
})
