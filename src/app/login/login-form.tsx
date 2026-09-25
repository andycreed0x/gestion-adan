import { loginAction } from './actions'

type LoginFormProps = {
  error?: string
  next: string
}

export function LoginForm({ error, next }: LoginFormProps) {
  return (
    <main className="login-shell">
      <form action={loginAction} className="login-card">
        <p className="eyebrow">Servicio Técnico ADAN</p>
        <h1>Ingresar</h1>
        <p className="muted">Usá las credenciales asignadas para operar órdenes.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </main>
  )
}
