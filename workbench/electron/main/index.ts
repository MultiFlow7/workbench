/**
 * Electron 主进程入口（v0.15 节点 1.2 + 1.4 — IPC + workspace 持久化）
 *
 * 职责：
 *  - 创建主窗口
 *  - 加载 renderer（开发模式走 vite dev server，生产走静态产物）
 *  - 注册所有 ipcMain.handle 通道（via registerIpcHandlers）
 *  - 节点 1.4: 首次启动或 electron-store 为空时弹出工作目录选择对话框
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import {
  hasPersistedWorkspaceCwd,
  registerIpcHandlers,
  setWorkspaceCwd,
} from '../ipc/handlers'
import { setPersistedCwd } from '../store/workspaceStore'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: '工作台 v0.15',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // 节点 1.2 起，preload 暴露 window.api 命名空间
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // 外链在系统浏览器中打开（防止 BrowserWindow 内导航逃逸）
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })

  // electron-vite 注入的开发模式 URL
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * 节点 1.4：首次启动若无持久化 cwd，弹出系统对话框让用户选择工作目录。
 * 用户取消时回退到 homedir 作为安全默认（fsGuard 仍生效），但不持久化——
 * 下次启动仍会再次弹窗，直至用户做出选择。
 */
async function ensureWorkspaceCwd(win: BrowserWindow): Promise<void> {
  if (hasPersistedWorkspaceCwd()) return
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: '选择工作目录（首次启动）',
    message: '工作台需要一个工作目录用于读写对话原子。可稍后在 P1 顶部更换。',
  })
  if (result.canceled || result.filePaths.length === 0) return
  const cwd = result.filePaths[0]
  setWorkspaceCwd(cwd)
  setPersistedCwd(cwd)
  win.webContents.send('workspace:changed', { cwd })
}

app.whenReady().then(() => {
  // 节点 1.2：集中注册所有 IPC 通道
  registerIpcHandlers()

  const win = createWindow()

  // 节点 1.4：首次启动检测并触发工作目录选择
  win.once('ready-to-show', () => {
    void ensureWorkspaceCwd(win)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
