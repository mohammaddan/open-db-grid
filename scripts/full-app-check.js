// Runs the REAL main entry (out/main/index.js) and inspects the renderer.
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

app.whenReady().then(async () => {
  require(join(process.cwd(), 'out/main/index.js'))
  await new Promise((r) => setTimeout(r, 2500))
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) {
    console.log('FULL_APP NO_WINDOW')
    app.exit(2)
    return
  }
  const w = wins[0]
  const apiOk = await w.webContents
    .executeJavaScript(
      "typeof window.api === 'object' && typeof window.api.connections.list === 'function'"
    )
    .catch(() => false)
  const mounted = await w.webContents
    .executeJavaScript("document.getElementById('root')?.children.length > 0")
    .catch(() => false)
  console.log('FULL_APP_API_OK=' + apiOk + ' MOUNTED=' + mounted)
  app.exit(apiOk && mounted ? 0 : 3)
})

app.on('window-all-closed', () => undefined)