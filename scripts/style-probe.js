// Boots the REAL main entry and samples computed styles to verify the theme
// is actually applied (catches dead CSS rules and unthemed components).
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

app.whenReady().then(async () => {
  require(join(process.cwd(), 'out/main/index.js'))
  await new Promise((r) => setTimeout(r, 2500))
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) {
    console.log('STYLE_PROBE NO_WINDOW')
    app.exit(2)
    return
  }
  const w = wins[0]
  // open a query tab so the CodeMirror editor mounts before probing
  await w.webContents
    .executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll('button, [role=button]')].find((b) =>
        /new query/i.test(b.title || b.getAttribute('aria-label') || '')
      )
      if (btn) { btn.click(); return true }
      return false
    })()`)
    .catch(() => false)
  await new Promise((r) => setTimeout(r, 1200))
  const probe = await w.webContents
    .executeJavaScript(`(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el) : null
      }
      const root = getComputedStyle(document.documentElement)
      const statusbar = cs('.statusbar')
      const cm = cs('.cm-editor')
      const tree = cs('.tree-row')
      const tab = cs('.editor-tab')
      return JSON.stringify({
        theme: document.documentElement.dataset.theme || '(none)',
        accent: root.getPropertyValue('--accent').trim(),
        synKeyword: root.getPropertyValue('--syn-keyword').trim(),
        appBg: cs('.app')?.backgroundColor,
        statusbarBg: statusbar?.backgroundColor,
        editorBg: cm?.backgroundColor,
        cmSelectionVar: cm ? 'applied' : 'missing-cm',
        treeRowHeight: tree?.height,
        tabHeight: tab?.height
      })
    })()`)
    .catch((e) => 'PROBE_ERR ' + e.message)
  console.log('STYLE_PROBE ' + probe)
  // flip to light theme and re-sample (settings store would normally do this)
  const lightProbe = await w.webContents
    .executeJavaScript(`(() => {
      document.documentElement.dataset.theme = 'light'
      const root = getComputedStyle(document.documentElement)
      const cm = document.querySelector('.cm-editor')
      return JSON.stringify({
        accent: root.getPropertyValue('--accent').trim(),
        synKeyword: root.getPropertyValue('--syn-keyword').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        statusbarBg: getComputedStyle(document.querySelector('.statusbar')).backgroundColor,
        editorBg: cm ? getComputedStyle(cm).backgroundColor : 'missing-cm'
      })
    })()`)
    .catch((e) => 'PROBE_ERR ' + e.message)
  console.log('STYLE_PROBE_LIGHT ' + lightProbe)
  app.exit(0)
})

app.on('window-all-closed', () => undefined)