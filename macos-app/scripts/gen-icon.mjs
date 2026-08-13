// Generates build/icon.png (1024x1024) from the official DeepSeek Harness
// favicon (the black whale) for the macOS app icon.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const faviconPath = process.env.DSH_FAVICON_PATH ||
  [resolve(here, '../../deepseek/apps/web/public/favicon.svg'), resolve(here, '../../apps/web/public/favicon.svg')]
    .find(p => existsSync(p)) ||
  resolve(here, '../../apps/web/public/favicon.svg')
const outPath = resolve(here, '../build/icon.png')

const svgText = readFileSync(faviconPath, 'utf8')
const match = svgText.match(/<path[^>]*d="([^"]+)"[^>]*\/?>/)
if (!match) throw new Error(`whale path not found in ${faviconPath}`)
const whale = match[1]

const SIZE = 1024
const ROUNDED_RADIUS = Math.round(SIZE * 0.2237)
const WHALE_WIDTH = 50
const scale = SIZE * 0.62 / WHALE_WIDTH
const offset = (SIZE - WHALE_WIDTH * scale) / 2

const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${ROUNDED_RADIUS}" fill="#ffffff"/>
  <rect x="0" y="-${SIZE}" width="${SIZE}" height="${SIZE}" rx="${ROUNDED_RADIUS}" fill="#ffffff"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${whale}" fill="#000000"/>
  </g>
</svg>`

const resvg = new Resvg(wrapper, { fitTo: { mode: 'width', value: SIZE } })
const png = resvg.render().asPng()
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, png)
console.log(`icon written: ${outPath} (${png.length} bytes)`)