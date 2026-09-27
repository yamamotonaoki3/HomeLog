import { expect, test as base, type ConsoleMessage, type Page } from '@playwright/test'

type AllowedError = {
  message: string | RegExp
  url?: string | RegExp
}

function matches(value: string, pattern: string | RegExp): boolean {
  return typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value)
}

export class ConsoleGuard {
  private readonly allowedErrors: AllowedError[] = []
  private readonly errors: string[] = []

  allow(error: AllowedError): void {
    this.allowedErrors.push(error)
  }

  watch(page: Page): void {
    page.on('console', (message) => this.recordConsoleError(message))
    page.on('pageerror', (error) => this.recordError(error.message, page.url()))
  }

  assertNoErrors(): void {
    expect(this.errors, `Unexpected browser console errors:\n${this.errors.join('\n')}`).toEqual([])
  }

  private recordConsoleError(message: ConsoleMessage): void {
    if (message.type() !== 'error') return
    this.recordError(message.text(), message.location().url)
  }

  private recordError(message: string, url: string): void {
    if (this.allowedErrors.some((allowed) => matches(message, allowed.message) && (!allowed.url || matches(url, allowed.url)))) {
      return
    }
    this.errors.push(`${url}: ${message}`)
  }
}

export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: async ({}, use) => {
    const consoleGuard = new ConsoleGuard()
    await use(consoleGuard)
    consoleGuard.assertNoErrors()
  },
})

export { expect }
