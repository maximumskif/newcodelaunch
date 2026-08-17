import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Without this, DOM trees from earlier tests in the same file stay mounted
// — harmless for single-test files (every test file so far, until this one
// started needing more than one), but multi-test files sharing recognizable
// text between cases would then get "found multiple elements" failures that
// have nothing to do with the component under test.
afterEach(() => {
  cleanup()
})
