import assert from 'node:assert/strict'
import { importLegacyContents } from './import-legacy-orders.mjs'

const result = importLegacyContents(
  'N° Orden: 9380 | Cliente: Ana | Equipo: TV | Falla: Cable | sin imagen | Resolución: Reemplazo\n',
)

assert.equal(result.accepted.length, 1)
assert.equal(result.accepted[0].orderNumber, 9380)
assert.equal(result.accepted[0].fault, 'Cable | sin imagen')
console.log('legacy importer test passed')
