import { expect, type Page } from '@playwright/test'

/**
 * Picks a value from one of the app's custom listboxes.
 *
 * These were native `<select>` elements, driven with `page.selectOption`. They
 * are DOM now — the platform popup drew outside the app window, and it could
 * not be clamped — so choosing means opening the menu and clicking the row.
 *
 * The trigger carries `data-value`, and this waits for it: the click commits
 * through React state and a caller that reads the viewport immediately
 * afterwards would otherwise race the re-render.
 */
export async function choose(page: Page, trigger: string, value: string): Promise<void> {
  await page.locator(trigger).click()
  await page.locator(`.select-menu [data-value="${value}"]`).click()
  await expect(page.locator(trigger)).toHaveAttribute('data-value', value)
}
