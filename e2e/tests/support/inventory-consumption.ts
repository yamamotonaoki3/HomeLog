import type { Page } from '@playwright/test'
import { register, createHousehold } from './flows'
import { newUser } from './test-data'

export async function setupConsumptionUser(page: Page, label: string) {
  const user = newUser(label)
  user.email = user.email.replace('e2euser_', 'testuser_')
  user.displayName = user.displayName.replace('e2euser_', 'testuser_')
  await register(page, user)
  await createHousehold(page, `[E2E_TEST] testuser_${label}`)
}
