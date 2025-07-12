const { app, BrowserWindow, Tray, Menu, Notification } = require('electron')
const WebSocket = require('ws')
const AutoLaunch = require('auto-launch')
const path = require('path')
const { exec } = require('child_process')
const screenshot = require('screenshot-desktop')
const http = require('http')

let mainWindow
let tray
let ws

const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const deviceIdFile = path.join(app.getPath('userData'), 'device-id.txt')

function getOrCreateDeviceId() {
  if (fs.existsSync(deviceIdFile)) {
    return fs.readFileSync(deviceIdFile, 'utf8')
  } else {
    const newId = crypto.randomUUID()
    fs.writeFileSync(deviceIdFile, newId)
    return newId
  }
}

function takeScreenshot() {
  const savePath = path.join(os.homedir(), 'Pictures', `screenshot-${Date.now()}.png`)
  screenshot({ filename: savePath })
    .then(() => {
      console.log('Screenshot saved to:', savePath)
      new Notification({ title: 'Screenshot Taken', body: `Saved to ${savePath}` }).show()
    })
    .catch((err) => {
      console.error('Failed to take screenshot:', err)
      new Notification({ title: 'Screenshot Failed', body: 'Error taking screenshot' }).show()
    })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 200,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  mainWindow.loadFile('index.html')
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'))
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.setToolTip('Device Agent')
  tray.setContextMenu(contextMenu)
}

function connectWebSocket() {
  ws = new WebSocket('wss://lumaaccess-server.onrender.com')

  ws.on('open', () => {
    console.log('Connected to backend')

    let deviceName = 'Unknown Device'
    try {
      const username = os.userInfo().username
      deviceName = `${username}'s Device`
    } catch (err) {
      console.warn('Failed to get username from OS:', err.message)
    }

    ws.send(JSON.stringify({
      type: 'register',
      userId: 'USER123',
      deviceId: getOrCreateDeviceId(),
      os: process.platform,
      hostname: os.hostname(),
      name: deviceName,
      status: 'online',
      lastSeen: new Date().toISOString(),
    }))

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
        console.log('Ping sent to server')
      }
    }, 240000)
  })

  ws.on('message', (message) => {
    const data = JSON.parse(message)
    console.log('Received message:', data)

    switch (data.type) {
      case 'Shutdown':
        new Notification({ title: 'Shutdown', body: 'Shutdown command received' }).show()
        exec('shutdown /s /t 0')
        break
      case 'Sleep':
        new Notification({ title: 'Sleep', body: 'Sleep command received' }).show()
        exec('rundll32.exe user32.dll,LockWorkStation')
        break
      case 'Restart':
        new Notification({ title: 'Restart', body: 'Restart command received' }).show()
        exec('shutdown /r /t 0')
        break
      case 'LockScreen':
        new Notification({ title: 'Lock Screen', body: 'Lock screen command received' }).show()
        exec('rundll32.exe user32.dll,LockWorkStation')
        break
      case 'Screenshot':
        new Notification({ title: 'Screenshot', body: 'Taking screenshot...' }).show()
        takeScreenshot()
        break
      default:
        console.log(`Unknown command type: ${data.type}`)
    }
  })

  ws.on('close', () => {
    console.log('Connection closed, retrying in 5s...')
    setTimeout(connectWebSocket, 5000)
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
  })
}

function startLocalHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({
        status: 'Agent running',
        deviceId: getOrCreateDeviceId(),
        os: process.platform,
        hostname: os.hostname()
      }))
    } else {
      res.writeHead(404, {
        'Access-Control-Allow-Origin': '*', 
      })
      res.end()
    }
  })

  server.listen(5967, () => {
    console.log('Local HTTP server running on http://localhost:5967')
  })

  server.on('error', (err) => {
    console.error('Error in local HTTP server:', err)
  })
}


app.whenReady().then(() => {
  createWindow()
  createTray()
  const autoLauncher = new AutoLaunch({ name: 'Device Agent' })
  autoLauncher.enable()
  connectWebSocket()
  startLocalHttpServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})
