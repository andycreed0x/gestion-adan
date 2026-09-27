import { OrderForm } from '@/components/order-form'

type NewOrderPageProps = { searchParams: Promise<{ error?: string }> }

export default async function NewOrderPage({ searchParams }: NewOrderPageProps) {
  const { error } = await searchParams
  return <section className="page-section"><a href="/orders">← Volver</a><h1>Nueva orden</h1><OrderForm mode="create" error={error} submitLabel="Guardar orden" /></section>
}
