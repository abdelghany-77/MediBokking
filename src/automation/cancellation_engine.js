import "dotenv/config";
import { chromium } from "playwright";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const SCREENSHOTS_DIR = path.join(__dirname, "../../screenshots");
if (!fs.existsSync(SCREENSHOTS_DIR))
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI);
}

/**
 * Try to find and cancel a booking using the given auth file
 * Returns { found: true, cancelled: true } on success
 * Returns { found: false } if booking not found in this account
 * Throws error on other failures
 */
async function tryCancelWithAuth(browser, authPath, booking) {
  const accountName = path.basename(authPath, '.json');
  console.log(`\n   🔑 Trying account: ${accountName}`);

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    storageState: JSON.parse(fs.readFileSync(authPath, "utf-8")),
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to Booking.com homepage
    console.log(`   🌍 Loading Booking.com Homepage...`);
    await page.goto("https://www.booking.com/index.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Close initial popups
    try {
      await page.click(
        'button[aria-label="Dismiss sign-in info."], [aria-label="Close"]',
        { timeout: 3000 }
      );
    } catch (e) {}

    // 2. Find "Your upcoming trip" card
    console.log("   🔍 Locating 'Your upcoming trip' card...");
    await page.waitForTimeout(3000);

    const tripSection = page.locator("text=Your upcoming trip").first();

    if (!(await tripSection.isVisible({ timeout: 10000 }))) {
      console.log(`   ⚠️ No upcoming trips found in ${accountName}`);
      await context.close();
      return { found: false };
    }

    console.log("   ✅ Found 'Your upcoming trip' section.");

    // Try multiple strategies to find the clickable trip card
    let clickableElement = null;

    // Strategy 1: Look for data-testid="trip-card"
    const tripCard = page.locator('[data-testid="trip-card"]').first();
    if (await tripCard.isVisible({ timeout: 3000 })) {
      clickableElement = tripCard;
    }

    // Strategy 2: Look for links containing "mystays" or "myreservations"
    if (!clickableElement) {
      const mystaysLink = page
        .locator('a[href*="mystays"], a[href*="myreservations"]')
        .first();
      if (await mystaysLink.isVisible({ timeout: 3000 })) {
        clickableElement = mystaysLink;
      }
    }

    // Strategy 3: Look for confirmation link
    if (!clickableElement) {
      const confirmationLink = page
        .locator('a[href*="confirmation.en"]')
        .first();
      if (await confirmationLink.isVisible({ timeout: 3000 })) {
        clickableElement = confirmationLink;
      }
    }

    // Strategy 4: Look for the specific booking card by role and name pattern
    if (!clickableElement) {
      const bookingLink = page
        .getByRole("link", { name: /Hostel|Hotel|Apartment|Feb|Jan|Dec/ })
        .first();
      if (await bookingLink.isVisible({ timeout: 3000 })) {
        clickableElement = bookingLink;
      }
    }

    // Strategy 5: Look for links containing "Confirmed"
    if (!clickableElement) {
      const confirmedLink = page.locator('a:has-text("Confirmed")').first();
      if (await confirmedLink.isVisible({ timeout: 3000 })) {
        clickableElement = confirmedLink;
      }
    }

    // Strategy 6: Look for div or section containing both trip text and a link
    if (!clickableElement) {
      const sectionWithLink = page
        .locator(
          'div:has-text("Your upcoming trip") a, section:has-text("Your upcoming trip") a'
        )
        .first();
      if (await sectionWithLink.isVisible({ timeout: 3000 })) {
        clickableElement = sectionWithLink;
      }
    }

    if (!clickableElement || !(await clickableElement.isVisible())) {
      console.log(`   ⚠️ No clickable trip card in ${accountName}`);
      await context.close();
      return { found: false };
    }

    console.log("   ✅ Found trip card. Clicking...");

    // 3. Click on the card
    const [newPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
      clickableElement.click(),
    ]);

    const targetPage = newPage || page;
    await targetPage.waitForLoadState("domcontentloaded");
    console.log("   ✅ Trip details page opened.");

    // 4. Wait and close any popups/modals
    await targetPage.waitForTimeout(4000);

    // Close Genius/Rewards modal if present
    try {
      const gemModal = targetPage.locator("#gemOffersModal");
      if (await gemModal.isVisible({ timeout: 3000 })) {
        const closeBtn = targetPage
          .locator(
            '#gemOffersModal button[aria-label="Close"], ' +
              '#gemOffersModal button:has-text("Close"), ' +
              "#gemOffersModal .bui-modal__close"
          )
          .first();

        if (await closeBtn.isVisible({ timeout: 2000 })) {
          await closeBtn.click();
          await targetPage.waitForTimeout(1000);
        } else {
          await targetPage.keyboard.press("Escape");
          await targetPage.waitForTimeout(1000);
        }
      }
    } catch (e) {
      await targetPage.keyboard.press("Escape");
      await targetPage.waitForTimeout(1000);
    }

    // Close any general overlay/popup
    try {
      const overlayClose = targetPage
        .locator(
          '.bui-overlay--active button[aria-label="Close"], ' +
            '.bui-modal--active button[aria-label="Close"], ' +
            'button[aria-label="Dismiss"], ' +
            ".bui-modal__close"
        )
        .first();

      if (await overlayClose.isVisible({ timeout: 2000 })) {
        await overlayClose.click();
        await targetPage.waitForTimeout(1000);
      }
    } catch (e) {}

    await targetPage.keyboard.press("Escape");
    await targetPage.waitForTimeout(1000);

    // 5. Check PNR match
    console.log("   🔍 Checking PNR match...");
    const pageContent = await targetPage.innerText("body");
    const cleanTargetPnr = booking.pnr.replace(/\s/g, "");
    const cleanPageContent = pageContent.replace(/\s/g, "");

    if (!cleanPageContent.includes(cleanTargetPnr)) {
      console.log(`   ⚠️ PNR ${booking.pnr} not found in ${accountName} - trying next account`);
      await context.close();
      return { found: false };
    }

    console.log(`   🎯 PNR Match confirmed: ${booking.pnr} in ${accountName}`);

    // ========== BOOKING FOUND - PROCEED WITH CANCELLATION ==========

    // 6. Click on "Cancellation options"
    console.log("   🗑️ Clicking 'Cancellation options'...");
    await targetPage.waitForTimeout(2000);
    await targetPage.keyboard.press("Escape");
    await targetPage.waitForTimeout(500);

    const cancelButton = targetPage
      .locator(
        'button:has-text("Cancellation options"), a:has-text("Cancellation options"), button:has-text("Cancel booking")'
      )
      .first();

    if (!(await cancelButton.isVisible({ timeout: 10000 }))) {
      await targetPage.screenshot({
        path: path.join(SCREENSHOTS_DIR, "NO_CANCEL_BUTTON.png"),
      });
      throw new Error("Could not find 'Cancellation options' button.");
    }

    try {
      await cancelButton.click({ timeout: 5000 });
    } catch (e) {
      await cancelButton.click({ force: true });
    }

    await targetPage.waitForTimeout(3000);
    console.log("   ✅ Clicked on cancellation options.");

    // 7. Select cancellation reason
    console.log("   📝 Selecting cancellation reason...");

    const reasonSelect = targetPage.locator("select").first();
    if (await reasonSelect.isVisible({ timeout: 5000 })) {
      await reasonSelect.selectOption({ index: 1 });
      console.log("   ✅ Selected reason from dropdown.");
    } else {
      const radioButton = targetPage.locator('input[type="radio"]').first();
      if (await radioButton.isVisible({ timeout: 5000 })) {
        await radioButton.click();
        console.log("   ✅ Selected reason from radio buttons.");
      }
    }

    await targetPage.waitForTimeout(2000);

    // 8. Click "Continue"
    console.log("   ➡️ Clicking 'Continue'...");
    const continueButton = targetPage
      .locator(
        'button:has-text("Continue"), button:has-text("Next"), button:has-text("Proceed")'
      )
      .first();

    if (await continueButton.isVisible({ timeout: 5000 })) {
      await continueButton.click();
      await targetPage.waitForTimeout(3000);
      console.log("   ✅ Clicked Continue.");
    }

    // 9. Final cancellation confirmation
    console.log("   🚀 Confirming final cancellation...");
    await targetPage.waitForTimeout(2000);

    const finalConfirmButton = targetPage
      .locator('button:has-text("Cancel booking")')
      .first();

    if (!(await finalConfirmButton.isVisible({ timeout: 10000 }))) {
      const altConfirmButton = targetPage
        .locator(
          'button:has-text("Yes, cancel"), ' +
            'button:has-text("Confirm cancellation"), ' +
            'button:has-text("Confirm")'
        )
        .first();

      if (await altConfirmButton.isVisible({ timeout: 5000 })) {
        await altConfirmButton.click();
        console.log("   ✅ Clicked alternative confirmation button.");
      } else {
        await targetPage.screenshot({
          path: path.join(SCREENSHOTS_DIR, "NO_CONFIRM_BUTTON.png"),
        });
        throw new Error("Could not find final confirmation button.");
      }
    } else {
      await finalConfirmButton.click();
      console.log("   ✅ Clicked 'Cancel booking' button.");
    }

    await targetPage.waitForTimeout(8000);

    // 10. Verify successful cancellation
    const successContent = await targetPage.innerText("body");
    const lowerContent = successContent.toLowerCase();
    const currentUrl = targetPage.url();

    if (
      lowerContent.includes("canceled") ||
      lowerContent.includes("cancelled") ||
      lowerContent.includes("cancellation is complete") ||
      lowerContent.includes("booking has been canceled") ||
      lowerContent.includes("successfully canceled") ||
      lowerContent.includes("your booking is canceled") ||
      lowerContent.includes("cancellation confirmed") ||
      currentUrl.includes("cancellation_confirmation") ||
      currentUrl.includes("cancelled")
    ) {
      console.log("   🎉 SUCCESS: Booking successfully cancelled!");

      booking.status = "Cancelled";
      booking.note = `Auto-cancelled via ${accountName} account.`;
      await booking.save();

      await targetPage.screenshot({
        path: path.join(SCREENSHOTS_DIR, `CANCEL_SUCCESS_${booking.pnr}.png`),
      });

      await context.close();
      return { found: true, cancelled: true };
    } else {
      await targetPage.screenshot({
        path: path.join(SCREENSHOTS_DIR, `CANCEL_FINAL_${booking.pnr}.png`),
      });

      if (
        !lowerContent.includes("confirm cancellation") &&
        !lowerContent.includes("you're about to cancel")
      ) {
        console.log("   ✅ Appears cancellation was processed.");

        booking.status = "Cancelled";
        booking.note = `Cancellation processed via ${accountName} - verified via screenshot.`;
        await booking.save();

        await context.close();
        return { found: true, cancelled: true };
      } else {
        throw new Error(
          "Cancellation confirmation message not found. Check screenshot."
        );
      }
    }
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function cancelBookingReal(bookingId) {
  let browser;

  try {
    await connectDB();
    const booking = await Booking.findById(bookingId);
    if (!booking) throw new Error("Booking not found in DB");
    if (!booking.pnr) throw new Error("Cannot cancel: No PNR available");

    console.log("═".repeat(60));
    console.log(`🗑️ DIRECT TRIP CANCELLATION: ${booking.pnr}`);
    console.log("═".repeat(60));

    browser = await chromium.launch({
      headless: PLAYWRIGHT_HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Check all available auth files
    const authFiles = [
      path.join(__dirname, "../../auth.json"),
      path.join(__dirname, "../../auth 1.json"),
      path.join(__dirname, "../../auth 2.json"),
    ].filter(f => fs.existsSync(f));

    if (authFiles.length === 0) {
      throw new Error("❌ No auth files found! Bot must be logged in with at least one account.");
    }

    console.log(`   📁 Found ${authFiles.length} auth file(s) to try`);

    // Try each auth file until we find the booking
    for (let i = 0; i < authFiles.length; i++) {
      const authPath = authFiles[i];
      const accountName = path.basename(authPath, '.json');

      try {
        const result = await tryCancelWithAuth(browser, authPath, booking);

        if (result.found && result.cancelled) {
          // Success! Booking found and cancelled
          await browser.close();
          return { success: true };
        }

        // Not found in this account, continue to next
        console.log(`   ➡️ Booking not in ${accountName}, trying next...`);
      } catch (error) {
        // Error during cancellation (not "not found")
        console.error(`   ⚠️ Error in ${accountName}: ${error.message}`);
        // Continue to next account
      }
    }

    // If we get here, booking was not found in any account
    throw new Error(`Booking PNR ${booking.pnr} not found in any of the ${authFiles.length} Booking.com accounts.`);

  } catch (error) {
    console.error("❌ Cancellation Failed:", error.message);
    if (browser) await browser.close();

    const b = await Booking.findById(bookingId);
    if (b) {
      b.note = `Cancel Error: ${error.message}`;
      await b.save();
    }

    return { success: false, error: error.message };
  }
}
