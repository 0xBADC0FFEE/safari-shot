import sharp from 'sharp'
// prints runs of similar color along a row or column
const [input, kind, pos, from, to] = process.argv.slice(2)
const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
const at = (x: number, y: number) => { const i = (y * info.width + x) * info.channels; return [data[i]!, data[i + 1]!, data[i + 2]!] }
let start = +from!, prev = kind === 'row' ? at(+from!, +pos!) : at(+pos!, +from!)
for (let t = +from! + 1; t <= +to!; t++) {
  const c = kind === 'row' ? at(t, +pos!) : at(+pos!, t)
  if (Math.abs(c[0]! - prev[0]!) + Math.abs(c[1]! - prev[1]!) + Math.abs(c[2]! - prev[2]!) > 6 || t === +to!) {
    console.log(`${start}-${t - 1} (${(start / 3).toFixed(1)}-${((t - 1) / 3).toFixed(1)}pt)`, prev.join(','))
    start = t
  }
  prev = c
}
