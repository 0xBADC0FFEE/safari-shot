import sharp from 'sharp'
const [input, ...specs] = process.argv.slice(2)
const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
const at = (x: number, y: number) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]].join(',') }
for (const spec of specs) {
  const [kind, a, b, c, d] = spec.split(':')
  if (kind === 'p') console.log(spec, at(+a!, +b!))
  if (kind === 'col') for (let y = +b!; y <= +c!; y += +d!) console.log(`x=${a} y=${y} (${(y / 3).toFixed(1)}pt)`, at(+a!, y))
  if (kind === 'row') for (let x = +b!; x <= +c!; x += +d!) console.log(`y=${a} x=${x} (${(x / 3).toFixed(1)}pt)`, at(x, +a!))
}
