import type { OrderTicketField } from '@/lib/order-ticket'

export function OrderTicketHeader() {
  return (
    <header>
      <h1>SERVICIO TÉCNICO ADAN</h1>
      <p>25 de Mayo 1231, San Fernando · Tel: (011) 4744-7009 · Whatsapp: 1158128304 (SOLO MENSAJES) - Lunes a viernes de 10 a 13 - 15.30 a 17.30</p>
    </header>
  )
}

export function OrderTicketFields({ rows }: { rows: OrderTicketField[][] }) {
  return (
    <table className="ticket-fields" aria-label="Datos de la orden">
      <colgroup><col className="ticket-label-column" /><col /><col className="ticket-label-column" /><col /></colgroup>
      <tbody>
        {rows.map((row) => (
          <tr key={row.map((item) => item.label).join('-')}>
            {row.flatMap((item) => [
              <th key={`${item.label}-label`} scope="row">{item.label}</th>,
              <td key={`${item.label}-value`} colSpan={row.length === 1 ? 3 : undefined}>{item.value}</td>,
            ])}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function OrderTicketFooter() {
  return (
    <footer>
      <p>El presupuesto tiene validez por 10 días, pasada dicha fecha el presupuesto será actualizado según el costo que los componentes sufran en el mercado.</p>
      <p>De no ser retirado pasados los 10 días de presupuestado, el equipo pasa a depósito y tiene un costo de $3000 por día por cargos de almacenamiento, sin excepción. Pasados 30 días se considera abandono quedando a disposición nuestra.</p>
      <p>Las reparaciones tienen 2 meses de garantía sobre lo reparado.</p>
    </footer>
  )
}
