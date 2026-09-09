import { expect, test } from '@playwright/test'

test('hosted mode fails closed when OIDC is not configured', async ({ page }) => {
  let apiRequests = 0
  await page.route('**/v1/**', async route => {
    apiRequests += 1
    await route.fulfill({ status: 500, body: 'unexpected request' })
  })

  await page.goto('/')

  await expect(page.getByRole('alert')).toHaveText('Hosted authentication is not configured.')
  await expect(page.getByText('API token')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Use token' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  expect(apiRequests).toBe(0)
})
