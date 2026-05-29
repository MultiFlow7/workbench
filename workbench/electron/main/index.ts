/**
 * Electron 主进程入口（v0.15 节点 1.1 骨架）
 *
 * 职责：
 *  - 创建主窗口
 *  - 加载 renderer（开发模式走 vite dev server，生产走静态产物）
 *  - 暴露最小生命周期 hook（节点 1.2 起注册 IPC handlers）
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
