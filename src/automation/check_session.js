import { chromium } from 'playwright';
import { readFileSync } from 'fs';

(async () => {
  let browser;
  try {
    console.log(' Verifying session...');

    // Load storage state from auth.json
    const storageState = JSON.parse(readFileSync('auth.json', 'utf-8'));

    // Launch Chromium in headless mode
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Create a new browser context with stored session and locale
    const context = await browser.newContext({
      storageState: storageState,
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Navigate to homepage
    console.log(' Navigating to https://www.booking.com/index.html...');
    await page.goto('https://www.booking.com/index.html', { waitUntil: 'domcontentloaded' });

    // Check for login status
    const signInButtonVisible = await page.isVisible('button[aria-label*="Sign in"], a[aria-label*="Sign in"], button:has-text("Sign in")').catch(() => false);
    const profileAvatarVisible = await page.isVisible('[data-testid="header-profile-button"], [aria-label*="profile"], [aria-label*="account"]').catch(() => false);

    // Take screenshot
    await page.screenshot({ path: 'screenshots/verify_session_fixed.png' });
    console.log('📸 Screenshot saved: screenshots/verify_session_fixed.png');

    // Log session status
    if (profileAvatarVisible && !signInButtonVisible) {
      console.log('✅ LOGGED IN');
    } else if (signInButtonVisible) {
      console.log('❌ NOT LOGGED IN');
    } else {
      console.log('ℹ️  Session status unclear - check screenshot');
    }

    await context.close();
  } catch (error) {
    console.error(' Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
