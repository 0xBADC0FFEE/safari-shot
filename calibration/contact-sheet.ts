import sharp from 'sharp'

const TILE_GAP_PX = 8

/**
 * Lays screenshots side by side, scaled to one width, for visual review.
 * @param output PNG path to write
 * @param tileWidth width of each tile in px
 * @param inputs image paths, left to right
 */
export async function contactSheet(output: string, tileWidth: number, inputs: string[]) {
  const tiles = await Promise.all(inputs.map(f => sharp(f).resize({ width: tileWidth }).toBuffer({ resolveWithObject: true })))
  const height = Math.max(...tiles.map(t => t.info.height))
  await sharp({ create: { width: (tileWidth + TILE_GAP_PX) * tiles.length, height, channels: 3, background: '#888' } })
    .composite(tiles.map((t, i) => ({ input: t.data, left: i * (tileWidth + TILE_GAP_PX), top: 0 })))
    .png().toFile(output)
}

if (import.meta.main) {
  const [output, width, ...inputs] = process.argv.slice(2)
  if (!output || !width || !inputs.length) throw new Error('usage: contact-sheet.ts <out.png> <tileWidth> <images...>')
  await contactSheet(output, Number(width), inputs)
}
