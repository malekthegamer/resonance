// Builds build/icon.ico from the rendered PNGs. Hand-assembled because the ICO
// container is trivial and this avoids another dependency.
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, '..', 'build')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const images = SIZES.map((size) => ({
  size,
  data: fs.readFileSync(path.join(OUT, `icon-${size}.png`))
}))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)

const entries = []
const HEADER_SIZE = 6 + images.length * 16
let offset = HEADER_SIZE

for (const img of images) {
  const entry = Buffer.alloc(16)
  // 256 is encoded as 0 in the ICO directory.
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0)
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1)
  entry.writeUInt8(0, 2) // palette count
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(img.data.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += img.data.length
}

fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
)
console.log('icon.ico:', fs.statSync(path.join(OUT, 'icon.ico')).size, 'bytes')
