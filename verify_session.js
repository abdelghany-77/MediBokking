import { chromium } from "playwright";
import fs from "fs";

(async () => {
  const AUTH_FILE = "auth 2.json";
  const SCREENSHOT_PATH = "session_verification.png";

  // 1. Check if the auth file exists
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`❌ Error: File '${AUTH_FILE}' not found.`);
    console.log("👉 Please run the conversion script first.");
    process.exit(1);
  }

  console.log(`📂 Loading session from: ${AUTH_FILE}`);

  // 2. Launch Browser (Headless: true for servers, set to false to see it opening)
  const browser = await chromium.launch({
    headless: true, // Change to false if you want to watch the browser open
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    // 3. Create context with the cookies injected
    // We read the file parsing it just to ensure it's valid JSON before passing to Playwright
    const storageState = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));

    const context = await browser.newContext({
      storageState: storageState, // Inject the cookies here
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    console.log("🌐 Navigating to Booking.com...");
    // We go to the account page directly to force a login check, or just home
    await page.goto("https://www.booking.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // 4. Verification Logic
    console.log("👀 Checking login status...");

    // Selectors for logged-in vs logged-out elements
    const loggedInSelector =
      '.header_user_avatar, .bui-avatar, button[aria-label*="Your account"], [data-testid="header-profile-menu-button"]';
    const loggedOutSelector =
      'a[data-testid="header-sign-in-button"], .header_sign_in_button';

    // Wait a moment for dynamic elements to render
    await page.waitForTimeout(3000);

    const isLoggedIn = await page
      .locator(loggedInSelector)
      .first()
      .isVisible()
      .catch(() => false);
    const isLoggedOut = await page
      .locator(loggedOutSelector)
      .first()
      .isVisible()
      .catch(() => false);

    // 5. Take Screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`📸 Screenshot saved to: ${SCREENSHOT_PATH}`);

    if (isLoggedIn) {
      console.log("\n✅ SUCCESS: You are LOGGED IN!");
      console.log("   The cookies are working correctly.");
    } else if (isLoggedOut) {
      console.log("\n❌ FAILURE: You are NOT logged in.");
      console.log(
        '   The "Sign In" button is visible. Cookies might be expired or invalid.'
      );
    } else {
      console.log(
        "\n⚠️ UNCERTAIN: Could not definitively detect login status."
      );
      console.log("   Please check the screenshot manually.");
    }
  } catch (error) {
    console.error("\n❌ CRITICAL ERROR:", error.message);
  } finally {
    await browser.close();
  }
})();
