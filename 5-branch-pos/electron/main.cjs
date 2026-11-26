/**
 * غلاف Electron اختياري: يشغّل نفس الخادم المحلي داخل نافذة تطبيق ويُفعّل التشغيل مع ويندوز.
 * غير مُجرَّب في بيئة التطوير هنا (لا يوجد Electron). الطريقة المضمونة: `npm run start` + متصفح Chrome بوضع التطبيق:
 *   chrome --app=http://127.0.0.1:7070
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

let agent;
async function start() {
  const { startBranchAgent } = await import('../src/headless.js');
  agent = await startBranchAgent({ dataDir: path.join(app.getPath('userData'), 'data'), port: 7070 });
  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, title: 'كاشير الفرع', webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadURL(`http://127.0.0.1:${agent.port}/`);
}
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => { app.setLoginItemSettings({ openAtLogin: true }); return start(); });
app.on('window-all-closed', async () => { await agent?.stop(); app.quit(); });
