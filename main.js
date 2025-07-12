const { app, BrowserWindow, Tray, Menu, Notification } = require('electron');
const WebSocket = require('ws');
const AutoLaunch = require('auto-launch');
const path = require('path');
const { exec } = require('child_process');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https'); // for secure POST
const http = require('http');
const deviceIdFile = path.join(app.getPath('userData'), 'device-id.txt');

// 🟡 Read or create persistent deviceId
function getOrCreateDeviceId() {
  if (fs.existsSync(deviceIdFile)) {
    return fs.readFileSync(deviceIdFile, 'utf8');
  } else {
    const newId = crypto.randomUUID();
    fs.writeFileSync(deviceIdFile, newId);
    return newId;
  }
}

// 🟡 Read userId from config written by .bat
function getUserIdFromConfig() {
  const configPath = path.join(os.homedir(), '.lumaagent', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const json = JSON.parse(raw);
    return json.userId || null;
  } catch (err) {
    console.error('Failed to read userId from config:', err.message);
    return null;
  }
}

function sendPairingToBackend(userId, deviceId, deviceName, os, hostname) {
  const data = JSON.stringify({ userId, deviceId, deviceName, os, hostname });

  const req = http.request({
    hostname: 'localhost',
    port: 8081,
    path: '/api/device/add-ownership',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  }, (res) => {
    console.log(`Pairing response status: ${res.statusCode}`);
    res.on('data', (d) => process.stdout.write(d));
  });

  req.on('error', (err) => {
    console.error('Pairing request error:', err.message);
  });

  req.write(data);
  req.end();
}


function takeScreenshot() {
  const savePath = path.join(os.homedir(), 'Pictures', `screenshot-${Date.now()}.png`);
  screenshot({ filename: savePath })
    .then(() => {
      console.log('Screenshot saved to:', savePath);
      new Notification({ title: 'Screenshot Taken', body: `Saved to ${savePath}` }).show();
    })
    .catch((err) => {
      console.error('Failed to take screenshot:', err);
      new Notification({ title: 'Screenshot Failed', body: 'Error taking screenshot' }).show();
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 300,
    height: 200,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Device Agent');
  tray.setContextMenu(contextMenu);
}

function connectWebSocket() {
  const userId = getUserIdFromConfig();
  const deviceId = getOrCreateDeviceId();

  // ws = new WebSocket('wss://lumaaccess-server.onrender.com');
  ws = new WebSocket('ws://localhost:8081');

  ws.on('open', () => {
    console.log('Connected to backend');

    let deviceName = 'Unknown Device';
    try {
      const username = os.userInfo().username;
      deviceName = `${username}'s Device`;
    } catch (err) {
      console.warn('Failed to get username from OS:', err.message);
    }

    // ✅ Pair device with backend only after deviceName is ready
    if (userId) {
      sendPairingToBackend(userId, deviceId, deviceName, os.platform(), os.hostname());
    }

    ws.send(JSON.stringify({
      type: 'register',
      userId: userId || 'UNKNOWN',
      deviceId,
      os: process.platform,
      hostname: os.hostname(),
      name: deviceName,
      status: 'online',
      lastSeen: new Date().toISOString(),
    }));

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        console.log('Ping sent to server');
      }
    }, 240000); // 4 minutes
  });

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Received message:', data);

  switch (data.type) {
  case 'Shutdown':
    new Notification({ title: 'Shutdown', body: 'Shutting down the system' }).show();
    exec('shutdown /s /t 0');
    break;

  case 'Restart':
    new Notification({ title: 'Restart', body: 'Restarting the system' }).show();
    exec('shutdown /r /t 0');
    break;

  case 'Sleep':
    new Notification({ title: 'Sleep', body: 'Putting system to sleep (locking)' }).show();
    exec('rundll32.exe user32.dll,LockWorkStation'); // Sleep not directly possible in Windows easily without admin
    break;

  case 'Lock Screen':
  case 'LockScreen':
    new Notification({ title: 'Lock Screen', body: 'Locking the screen' }).show();
    exec('rundll32.exe user32.dll,LockWorkStation');
    break;

  case 'Unlock Screen':
    new Notification({ title: 'Unlock Screen', body: 'Unlock requested (not supported)' }).show();
    // Unlock not programmatically possible due to security — show info only
    break;

  case 'Screenshot':
    new Notification({ title: 'Screenshot', body: 'Capturing screenshot...' }).show();
    takeScreenshot();
    break;

  case 'Access Files':
  case 'File Manager':
    new Notification({ title: 'File Manager', body: 'Opening file explorer' }).show();
    exec('explorer.exe');
    break;

  case 'Access Terminal':
    new Notification({ title: 'Terminal', body: 'Opening terminal' }).show();
    exec('start cmd'); // opens Command Prompt
    break;

  case 'Open Camera':
    new Notification({ title: 'Camera', body: 'Opening camera (if supported)' }).show();
    exec('start microsoft.windows.camera:'); // works in Windows 10/11
    break;

  case 'Control Audio':
    new Notification({ title: 'Audio Control', body: 'Opening sound settings' }).show();
    exec('start ms-settings:sound');
    break;

  case 'Mute Audio':
    new Notification({ title: 'Mute', body: 'Muting system audio' }).show();
    // Mute not directly possible via shell — consider using `nircmd` or native node module
    break;

  case 'Screen Share':
    new Notification({ title: 'Screen Share', body: 'Screen sharing not implemented yet' }).show();
    break;

  case 'Download Files':
    new Notification({ title: 'Download Files', body: 'Download command received (pending implementation)' }).show();
    break;

  case 'Upload Files':
    new Notification({ title: 'Upload Files', body: 'Upload command received (pending implementation)' }).show();
    break;

  case 'System Settings':
    new Notification({ title: 'System Settings', body: 'Opening settings...' }).show();
    exec('start ms-settings:');
    break;

  default:
    console.log(`Unknown command type: ${data.type}`);
    new Notification({ title: 'Unknown Command', body: `No handler for: ${data.type}` }).show();
}

  });

  ws.on('close', () => {
    console.log('Connection closed, retrying in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}


function startLocalHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({
        status: 'Agent running',
        deviceId: getOrCreateDeviceId(),
        os: process.platform,
        hostname: os.hostname()
      }));
    } else {
      res.writeHead(404, {
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
    }
  });

  server.listen(5967, () => {
    console.log('Local HTTP server running on http://localhost:5967');
  });

  server.on('error', (err) => {
    console.error('Error in local HTTP server:', err);
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  const autoLauncher = new AutoLaunch({ name: 'Device Agent' });
  autoLauncher.enable();
  connectWebSocket();
  startLocalHttpServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // keep app running in tray
});
