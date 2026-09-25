import { readFile } from 'node:fs/promises'

const labels = ['N° Orden', 'Fecha Ingreso', 'Cliente', 'Dir', 'Tel', 'Equipo', 'Accesorios', 'Falla', 'Resolución', 'Presupuesto', 'Fecha Retiro']
const labelPattern = new RegExp(`(?:^|\\s\\|\\s)(${labels.join('|')}):\\s*`, 'g')

export function parseLegacyLine(line) {
  const matches = [...line.matchAll(labelPattern)]
  const fields = {}
  for (const [index, match] of matches.entries()) {
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? line.length
    fields[match[1]] = line.slice(start, end).replace(/\s\|\s$/, '').trim()
  }
  const digits = (fields['N° Orden'] ?? '').replace(/\D/g, '')
  if (!digits || !fields.Cliente || !fields.Equipo) throw new Error('Orden incompleta o sin número válido')
  return {
    orderNumber: Number(digits),
    receivedOn: fields['Fecha Ingreso'] ?? '',
    customerName: fields.Cliente,
    address: fields.Dir ?? '',
    phone: fields.Tel ?? '',
    equipment: fields.Equipo,
    accessories: fields.Accesorios ?? '',
    fault: fields.Falla ?? '',
    resolution: fields.Resolución ?? '',
    budget: fields.Presupuesto ?? '',
    pickedUpOn: fields['Fecha Retiro'] ?? '',
  }
}

export function importLegacyContents(contents) {
  const accepted = []
  const rejected = []
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue
    try { accepted.push(parseLegacyLine(rawLine)) }
    catch (error) { rejected.push({ line: index + 1, message: error instanceof Error ? error.message : 'Error desconocido', rawLine }) }
  }
  return { accepted, rejected }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const inputPath = process.argv[2]
  if (!inputPath) throw new Error('Uso: node scripts/import-legacy-orders.mjs ruta/al/ordenes_servicio.txt')
  const result = importLegacyContents(await readFile(inputPath, 'utf8'))
  console.log(JSON.stringify(result, null, 2))
}
