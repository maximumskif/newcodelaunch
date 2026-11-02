import { lazy, type ComponentType } from 'react'

const RELOADED_KEY = 'nocode-launchpad.chunk-reload'

// A route's page, loaded when it's first visited instead of in the main
// bundle. After a redeploy, an open tab's old index points at chunk files
// that no longer exist; the import fails, so reload once to pick up the new
// build. The flag stops a loop if the chunk is really unreachable (offline),
// in which case the error reaches the route's error boundary.
export function lazyPage<Props extends object>(load: () => Promise<ComponentType<Props>>) {
  return lazy(async () => {
    try {
      const Component = await load()
      try {
        sessionStorage.removeItem(RELOADED_KEY)
      } catch {
        // Storage blocked: nothing to clear.
      }
      return { default: Component }
    } catch (err) {
      let reloaded = true
      try {
        reloaded = sessionStorage.getItem(RELOADED_KEY) === '1'
        if (!reloaded) sessionStorage.setItem(RELOADED_KEY, '1')
      } catch {
        // Storage blocked: don't risk a reload loop.
      }
      if (!reloaded) {
        window.location.reload()
        // Never resolves: the page is reloading.
        return new Promise<never>(() => {})
      }
      throw err
    }
  })
}
