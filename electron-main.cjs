const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Budget Tracker v2',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Remove standard browser menu bar for a clean, distraction-free AMOLED look
  Menu.setApplicationMenu(null);

  const indexPath = path.join(__dirname, 'dist', 'index.html');
  win.loadFile(indexPath);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
