import { test, expect } from '@playwright/test';

test.describe('Cookie Management', () => {
  test.beforeEach(async ({ context }) => {
    // Clear all cookies before each test
    await context.clearCookies();
  });

  test.describe('Cookie Banner', () => {
    test('should display cookie banner on first visit', async ({ page }) => {
      await page.goto('/');
      
      // Check cookie banner is visible
      const cookieBanner = page.locator('.govuk-cookie-banner');
      await expect(cookieBanner).toBeVisible();
      
      // Check banner content
      await expect(cookieBanner).toContainText('Cookies on this service');
      await expect(cookieBanner).toContainText('We use some essential cookies to make this service work');
      
      // Check buttons are present
      const acceptButton = cookieBanner.locator('button:has-text("Accept analytics cookies")');
      const rejectButton = cookieBanner.locator('button:has-text("Reject analytics cookies")');
      const viewCookiesLink = cookieBanner.locator('a:has-text("View cookies")');
      
      await expect(acceptButton).toBeVisible();
      await expect(rejectButton).toBeVisible();
      await expect(viewCookiesLink).toBeVisible();
    });

    test('should not display cookie banner on cookies page', async ({ page }) => {
      await page.goto('/cookies');
      
      // Cookie banner should not be visible on the cookies page itself
      const cookieBanner = page.locator('.govuk-cookie-banner');
      await expect(cookieBanner).not.toBeVisible();
    });

    test('should hide banner after accepting cookies', async ({ page }) => {
      await page.goto('/');
      
      // Wait for JavaScript to load
      await page.waitForLoadState('networkidle');
      
      // Click accept button
      const acceptButton = page.locator('button:has-text("Accept analytics cookies")');
      await acceptButton.click();
      
      // Wait for cookies to be set
      await page.waitForTimeout(1000);
      
      // Check that cookie policy was set with accepted state
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
      const policyValue = decodeURIComponent(cookiePolicy!.value);
      expect(policyValue).toContain('"analytics":"on"');
      
      // Navigate to another page
      await page.goto('/cookies');
      await page.goto('/');
      
      // Banner should still be hidden when returning to homepage
      const cookieBanner = page.locator('.govuk-cookie-banner');
      await expect(cookieBanner).not.toBeVisible();
    });

    test('should hide banner after rejecting cookies', async ({ page }) => {
      await page.goto('/');
      
      // Wait for JavaScript to load
      await page.waitForLoadState('networkidle');
      
      // Click reject button
      const rejectButton = page.locator('button:has-text("Reject analytics cookies")');
      await rejectButton.click();
      
      // Wait for cookies to be set
      await page.waitForTimeout(1000);
      
      // Check that cookie policy was set with rejected state
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
      const policyValue = decodeURIComponent(cookiePolicy!.value);
      expect(policyValue).toContain('"analytics":"off"');
      
      // Navigate to another page
      await page.goto('/cookies');
      await page.goto('/');
      
      // Banner should still be hidden when returning to homepage
      const cookieBanner = page.locator('.govuk-cookie-banner');
      await expect(cookieBanner).not.toBeVisible();
    });

    test('should navigate to cookie preferences page', async ({ page }) => {
      await page.goto('/');
      
      // Click "View cookies" link
      const viewCookiesLink = page.locator('.govuk-cookie-banner a:has-text("View cookies")');
      await viewCookiesLink.click();
      
      // Should navigate to cookies page
      await expect(page).toHaveURL('/cookies');
      
      // Check page title
      await expect(page.locator('h1')).toHaveText('Cookie preferences');
    });
  });

  test.describe('Cookie Preferences Page', () => {
    test('should display cookie preferences form', async ({ page }) => {
      await page.goto('/cookies');
      
      // Check page title
      await expect(page.locator('h1')).toHaveText('Cookie preferences');
      
      // Check essential cookies section
      await expect(page.locator('text=Essential cookies')).toBeVisible();
      await expect(page.locator('text=These cookies are necessary for the service to function')).toBeVisible();
      
      // Check analytics cookies section
      await expect(page.locator('h2:has-text("Analytics cookies")')).toBeVisible();
      await expect(page.locator('text=help us understand how you use the service').first()).toBeVisible();
      
      // Check settings cookies section
      await expect(page.locator('h2:has-text("Settings cookies")')).toBeVisible();
      await expect(page.locator('text=remember your settings and preferences').first()).toBeVisible();
      
      // Check radio buttons
      const analyticsYes = page.locator('#analytics-yes');
      const analyticsNo = page.locator('#analytics-no');
      const preferencesYes = page.locator('#preferences-yes');
      const preferencesNo = page.locator('#preferences-no');
      
      await expect(analyticsYes).toBeVisible();
      await expect(analyticsNo).toBeVisible();
      await expect(preferencesYes).toBeVisible();
      await expect(preferencesNo).toBeVisible();
      
      // Check save button
      const saveButton = page.locator('button:has-text("Save cookie preferences")');
      await expect(saveButton).toBeVisible();
    });

    test('should save cookie preferences', async ({ page }) => {
      await page.goto('/cookies');
      
      // Select analytics yes, preferences no
      await page.locator('#analytics-yes').check();
      await page.locator('#preferences-no').check();
      
      // Click save button
      await page.locator('button:has-text("Save cookie preferences")').click();
      
      // Wait for the form to be processed
      await page.waitForTimeout(1000);
      
      // The HMCTS cookie manager handles the form client-side
      // so we just check that the cookies were saved correctly
      
      // Check that preferences were saved
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
      const policyValue = JSON.parse(decodeURIComponent(cookiePolicy!.value));
      expect(policyValue.analytics).toBe("on");
      expect(policyValue.preferences).toBe("off");
    });

    test('should reflect current cookie preferences', async ({ page }) => {
      // First set some preferences
      await page.goto('/cookies');
      await page.locator('#analytics-no').check();
      await page.locator('#preferences-yes').check();
      await page.locator('button:has-text("Save cookie preferences")').click();
      
      // Navigate away and come back
      await page.goto('/');
      await page.goto('/cookies');
      
      // Check that the radio buttons reflect the saved preferences
      await expect(page.locator('#analytics-no')).toBeChecked();
      await expect(page.locator('#preferences-yes')).toBeChecked();
      await expect(page.locator('#analytics-yes')).not.toBeChecked();
      await expect(page.locator('#preferences-no')).not.toBeChecked();
    });

    test('should work with Welsh language', async ({ page }) => {
      // Switch to Welsh
      await page.goto('/cookies?lng=cy');
      
      // Check Welsh translations
      await expect(page.locator('h1')).toHaveText('Dewisiadau cwcis');
      await expect(page.locator('h2:has-text("Cwcis hanfodol")')).toBeVisible();
      await expect(page.locator('h2:has-text("Cwcis dadansoddi")')).toBeVisible();
      await expect(page.locator('h2:has-text("Cwcis gosodiadau")')).toBeVisible();
      
      // Check Welsh button text
      await expect(page.locator('button:has-text("Cadw dewisiadau cwcis")')).toBeVisible();
      
      // Save preferences in Welsh
      await page.locator('#analytics-yes').check();
      await page.locator('button:has-text("Cadw dewisiadau cwcis")').click();
      
      // Wait for the form to be processed
      await page.waitForTimeout(1000);
      
      // The HMCTS cookie manager handles the form client-side
      // Check that preferences were saved correctly
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
    });
  });

  test.describe('Cookie Banner JavaScript Behavior', () => {
    test('should handle accept button click with JavaScript', async ({ page }) => {
      await page.goto('/');
      
      // Wait for JavaScript to load
      await page.waitForLoadState('networkidle');
      
      // Click accept button
      const acceptButton = page.locator('.js-cookie-banner-accept');
      await acceptButton.click();
      
      // Wait for JavaScript to handle the click and set cookies
      await page.waitForTimeout(1000);
      
      // Check that cookies were set
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
      const policyValue = decodeURIComponent(cookiePolicy!.value);
      expect(policyValue).toMatch(/"analytics":(?:true|"on")/);
    });

    test('should handle reject button click with JavaScript', async ({ page }) => {
      await page.goto('/');
      
      // Wait for JavaScript to load
      await page.waitForLoadState('networkidle');
      
      // Click reject button
      const rejectButton = page.locator('.js-cookie-banner-reject');
      await rejectButton.click();
      
      // Wait for JavaScript to handle the click and set cookies
      await page.waitForTimeout(1000);
      
      // Check that cookies were set
      const cookies = await page.context().cookies();
      const cookiePolicy = cookies.find(c => c.name === 'cookie_policy');
      expect(cookiePolicy).toBeDefined();
      const policyValue = decodeURIComponent(cookiePolicy!.value);
      expect(policyValue).toMatch(/"analytics":(?:false|"off")/);
    });
  });

  test.describe('Accessibility', () => {
    test('cookie banner should be accessible', async ({ page }) => {
      await page.goto('/');
      
      // The banner should have proper ARIA attributes
      const cookieBanner = page.locator('.govuk-cookie-banner');
      await expect(cookieBanner).toHaveAttribute('role', 'region');
      await expect(cookieBanner).toHaveAttribute('aria-label', 'Cookies on this service');
    });

    test('cookie preferences page should be accessible', async ({ page }) => {
      await page.goto('/cookies');
      
      // Check for proper form structure
      const form = page.locator('form');
      await expect(form).toBeVisible();
      
      // Check fieldsets have legends
      const fieldsets = page.locator('fieldset');
      const count = await fieldsets.count();
      
      for (let i = 0; i < count; i++) {
        const fieldset = fieldsets.nth(i);
        const legend = fieldset.locator('legend');
        await expect(legend).toBeVisible();
      }
      
      // Check radio buttons have labels
      const radios = page.locator('input[type="radio"]');
      const radioCount = await radios.count();
      
      for (let i = 0; i < radioCount; i++) {
        const radio = radios.nth(i);
        const id = await radio.getAttribute('id');
        const label = page.locator(`label[for="${id}"]`);
        await expect(label).toBeVisible();
      }
    });
  });
});