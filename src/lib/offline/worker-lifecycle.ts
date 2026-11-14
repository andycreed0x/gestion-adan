export function waitForOfflineWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) return Promise.reject(new Error('El modo offline todavía no está activo'))
  if (worker.state === 'activated') return Promise.resolve(worker)
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return
      clearTimeout(timeout)
      worker.removeEventListener('statechange', finish)
      if (worker.state === 'activated') resolve(worker)
      else reject(new Error('La actualización del modo offline fue reemplazada. Reintentá con conexión.'))
    }
    const timeout = setTimeout(() => {
      worker.removeEventListener('statechange', finish)
      reject(new Error('La actualización del modo offline no terminó'))
    }, 30_000)
    worker.addEventListener('statechange', finish)
    finish()
  })
}
