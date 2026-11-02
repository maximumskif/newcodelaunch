import { render, screen } from '@testing-library/react'
import { Component, Suspense, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lazyPage } from './lazyPage'

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p>failed</p> : this.props.children
  }
}

const show = (Page: ReturnType<typeof lazyPage>) =>
  render(
    <Boundary>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </Boundary>,
  )

describe('lazyPage', () => {
  const reload = vi.fn()
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('location', { ...window.location, reload })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    reload.mockReset()
  })

  it('renders the page once its code loads', async () => {
    show(lazyPage(async () => () => <p>the page</p>))
    expect(await screen.findByText('the page')).toBeInTheDocument()
  })

  it('reloads once when a chunk from an older deploy is gone', async () => {
    show(lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it("doesn't loop: after one reload the error reaches the error boundary", async () => {
    sessionStorage.setItem('nocode-launchpad.chunk-reload', '1')
    show(lazyPage(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))))
    expect(await screen.findByText('failed')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
