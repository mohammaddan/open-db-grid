// Headless renderer smoke check (dev only): boots the BUILT app window under
// Xvfb/CI and reports whether the React root actually mounted.
//   xvfb-run -a node_modules/electron/dist/electron scripts/render-smoke.js --no-sandbox
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(process.cwd(), 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.webContents.on('console-message', (_e, _level, msg) => {
    if (/Uncaught|dbforge:toast/.test(msg)) console.log('RENDERER_LOG', msg)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('RENDERER_FAIL', code, desc)
    app.exit(1)
  })
  await win.loadFile(join(process.cwd(), 'out/renderer/index.html'))
  await new Promise((r) => setTimeout(r, 3000))
  const mounted = await win.webContents.executeJavaScript(
    "document.getElementById('root')?.children.length > 0"
  )
  console.log('RENDERER_ACTION', mounted ? 'MOUNTED_OK' : 'MOUNT_EMPTY')
  app.exit(mounted ? 0 : 2)
})