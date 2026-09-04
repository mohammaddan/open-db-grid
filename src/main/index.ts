// Electron main entry point. Bootstraps the app store, credential store,
// services, IPC, and the application window.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { JsonStore, storeFilePath } from '@main/persistence/Store'
import { CredentialStore } from '@main/persistence/CredentialStore'
import { defaultAppData } from '@main/services/AppData'
import type { AppData } from '@main/services/AppData'
import { ConnectionService } from '@main/services/ConnectionService'
import { QueryService } from '@main/services/QueryService'
import { ExplorerService } from '@main/services/ExplorerService'
import { TransactionService } from '@main/services/TransactionService'
import { HistoryService, SavedQueriesService } from '@main/services/HistoryService'
import { SettingsService } from '@main/services/SettingsService'
import { registerIpc, type AppServices } from '@main/ipc'

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#1d1f24',
    title: 'DBForge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------

let store: JsonStore<AppData> | null = null
let credentials: CredentialStore | null = null
let services: AppServices | null = null
let sweepTimer: NodeJS.Timeout | null = null
let appReady = false

async function bootstrap(): Promise<void> {
  const dataDir = app.getPath('userData')
  store = new JsonStore<AppData>(storeFilePath(dataDir), defaultAppData)
  const data = await store.load()

  // credential store: unwrap the app key from the store file (if any)
  credentials = new CredentialStore(data.key ?? null)
  if (credentials.available && !data.key) {
    const wrapped = credentials.initKey()
    if (wrapped) {
      data.key = wrapped
      await store.save()
    }
  }
  credentials.loadPersisted(data.credentials)

  const connections = new ConnectionService(store, credentials)
  const history = new HistoryService(store, connections)
  const queries = new QueryService(connections, history)
  const explorer = new ExplorerService(connections)
  const transactions = new TransactionService(connections)
  const saved = new SavedQueriesService(store)
  const settings = new SettingsService(store)

  services = { connections, queries, explorer, transactions, history, saved, settings }
  registerIpc(services)

  // background sweep: close cursor sessions idle > 15 min
  sweepTimer = setInterval(() => {
    void connections.sweepIdleCursors(15 * 60 * 1000).catch(() => undefined)
  }, 60_000)

  appReady = true
}

app.whenReady().then(async () => {
  await bootstrap()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function persistOnExit(): Promise<void> {
  if (!store || !credentials || !appReady) return
  try {
    const data = store.data
    if (credentials.available) {
      data.key = data.key ?? credentials.initKey() ?? undefined
      data.credentials = credentials.toPersisted()
      await store.save()
    } else {
      // memory-only credentials must not be written — strip them
      data.credentials = {}
      await store.save()
    }
  } catch (err) {
    console.warn('[main] could not persist app data on exit:', err)
  }
}

app.on('before-quit', (event) => {
  // synchronous guard: allow async persist then quit
  if (sweepTimer) clearInterval(sweepTimer)
  event.preventDefault()
  void persistOnExit().finally(() => {
    app.exit(0)
  })
})

app.on('will-quit', () => {
  if (sweepTimer) clearInterval(sweepTimer)
})