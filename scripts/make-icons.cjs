// Renders build/icon.svg to PNGs at every size electron-builder needs, using
// Electron's own Chromium — no native image library required.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const OUT = path.join(__dirname, '..', 'build')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(OUT, 'icon.svg'), 'utf8')
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false,
    webPreferences: { offscreen: true }
  })

  for (const size of SIZES) {
    const html = `<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px">${svg.replace(/width='1024'/, `width='${size}'`).replace(/height='1024'/, `height='${size}'`)}</div>
    </body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 120))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), image.toPNG())
    console.log(`wrote icon-${size}.png`)
  }

  fs.copyFileSync(path.join(OUT, 'icon-512.png'), path.join(OUT, 'icon.png'))
  // Tray icons: small, and a dedicated 32px for HiDPI trays.
  fs.copyFileSync(path.join(OUT, 'icon-16.png'), path.join(OUT, 'tray.png'))
  fs.copyFileSync(path.join(OUT, 'icon-32.png'), path.join(OUT, 'tray@2x.png'))
  app.quit()
})
