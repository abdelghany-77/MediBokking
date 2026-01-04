/**
 * Download PDF from an existing Booking.com reservation
 */

import "dotenv/config";
import { chromium } from "playwright";
import mongoose from "mongoose";
import Booking from "./src/models/Booking.js";
import { sendTicketEmail } from "./src/services/email_service.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/travel_automation";
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const SCREENSHOTS_DIR = path.join(__dirname, "./screenshots");
const DOWNLOADS_DIR = path.join(__dirname, "./downloads");

if (!fs.existsSync(SCREENSHOTS_DIR))
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR))
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

async function downloadBookingPDF(pnr, clientEmail) {
  let browser, context, page;

  console.log("═".repeat(60));
  console.log("📄 BOOKING.COM PDF DOWNLOADER");
  console.log("═".repeat(60));
  console.log(`🔖 PNR: ${pnr}`);
  console.log(`📧 Email: ${clientEmail || "Not provided"}`);
  console.log("═".repeat(60));

  try {
    // Launch browser
    console.log("\n🚀 Launching browser...");
    browser = await chromium.launch({
      headless: PLAYWRIGHT_HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Load auth session
    const authPath = path.join(__dirname, "./auth.json");
    if (!fs.existsSync(authPath)) {
      throw new Error("❌ No auth.json found! Bot must be logged in.");
    }

    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      storageState: JSON.parse(fs.readFileSync(authPath, "utf-8")),
    });

    page = await context.newPage();

    // 1. Navigate to Booking.com homepage
    console.log("\n🌍 Loading Booking.com Homepage...");
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

    console.log("🔍 Locating 'Your upcoming trip' card...");
    await page.waitForTimeout(3000);

    const tripSection = page.locator("text=Your upcoming trip").first();

    if (!(await tripSection.isVisible({ timeout: 10000 }))) {
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, "NO_UPCOMING_TRIP_PDF.png"),
      });
      throw new Error(
        "No 'Your upcoming trip' section found. Is the account logged in?"
      );
    }

    console.log("   ✅ Found 'Your upcoming trip' section.");

    // Find clickable trip card using multiple strategies
    let clickableElement = null;

    // Strategy 1: data-testid="trip-card"
    const tripCard = page.locator('[data-testid="trip-card"]').first();
    if (await tripCard.isVisible({ timeout: 3000 })) {
      clickableElement = tripCard;
      console.log("   ✅ Found trip card via data-testid.");
    }

    // Strategy 2: mystays/myreservations link
    if (!clickableElement) {
      const mystaysLink = page
        .locator('a[href*="mystays"], a[href*="myreservations"]')
        .first();
      if (await mystaysLink.isVisible({ timeout: 3000 })) {
        clickableElement = mystaysLink;
        console.log("   ✅ Found trip card via mystays/myreservations link.");
      }
    }

    // Strategy 3: confirmation link
    if (!clickableElement) {
      const confirmationLink = page
        .locator('a[href*="confirmation.en"]')
        .first();
      if (await confirmationLink.isVisible({ timeout: 3000 })) {
        clickableElement = confirmationLink;
        console.log("   ✅ Found trip card via confirmation link.");
      }
    }

    // Strategy 4: booking name pattern
    if (!clickableElement) {
      const bookingLink = page
        .getByRole("link", {
          name: /Hostel|Hotel|Apartment|Feb|Jan|Dec|Mar|Apr|Oct/,
        })
        .first();
      if (await bookingLink.isVisible({ timeout: 3000 })) {
        clickableElement = bookingLink;
        console.log("   ✅ Found trip card via booking name pattern.");
      }
    }

    // Strategy 5: Confirmed text
    if (!clickableElement) {
      const confirmedLink = page.locator('a:has-text("Confirmed")').first();
      if (await confirmedLink.isVisible({ timeout: 3000 })) {
        clickableElement = confirmedLink;
        console.log("   ✅ Found trip card via Confirmed text.");
      }
    }

    // Strategy 6: section with link
    if (!clickableElement) {
      const sectionWithLink = page
        .locator(
          'div:has-text("Your upcoming trip") a, section:has-text("Your upcoming trip") a'
        )
        .first();
      if (await sectionWithLink.isVisible({ timeout: 3000 })) {
        clickableElement = sectionWithLink;
        console.log("   ✅ Found trip card via section link.");
      }
    }

    if (!clickableElement || !(await clickableElement.isVisible())) {
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, "NO_CLICKABLE_TRIP_PDF.png"),
      });
      throw new Error("Could not find clickable trip card element.");
    }

    console.log("   ✅ Found trip card. Clicking...");

    // 3. Click on the card (may open in same page or new tab)
    const [newPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
      clickableElement.click(),
    ]);

    const targetPage = newPage || page;
    await targetPage.waitForLoadState("domcontentloaded");
    console.log("   ✅ Trip details page opened.");

    // 4. Close popups/modals
    console.log("   ⏳ Closing any popups...");
    await targetPage.waitForTimeout(4000);

    // Close Genius modal
    try {
      const gemModal = targetPage.locator("#gemOffersModal");
      if (await gemModal.isVisible({ timeout: 3000 })) {
        console.log("   � Closing Genius modal...");
        await targetPage.keyboard.press("Escape");
        await targetPage.waitForTimeout(1000);
      }
    } catch (e) {}

    // Close overlay
    try {
      const overlayClose = targetPage
        .locator(
          '.bui-overlay--active button[aria-label="Close"], .bui-modal--active button[aria-label="Close"], button[aria-label="Dismiss"], .bui-modal__close'
        )
        .first();
      if (await overlayClose.isVisible({ timeout: 2000 })) {
        await overlayClose.click();
        await targetPage.waitForTimeout(1000);
      }
    } catch (e) {}

    // Escape to close any remaining modals
    await targetPage.keyboard.press("Escape");
    await targetPage.waitForTimeout(1000);

    // 5. Verify PNR match
    console.log("   🔍 Checking PNR match...");
    const pageContent = await targetPage.innerText("body");
    const cleanPnr = pnr.replace(/\s/g, "");
    const cleanContent = pageContent.replace(/\s/g, "");

    if (!cleanContent.includes(cleanPnr)) {
      console.log(
        `   ⚠️ PNR ${pnr} not visible on page (may still be correct booking)`
      );
    } else {
      console.log(`   🎯 PNR Match confirmed: ${pnr}`);
    }

    // Take screenshot
    await targetPage.screenshot({
      path: path.join(SCREENSHOTS_DIR, `PDF_BOOKING_PAGE_${pnr}.png`),
    });
    console.log(`   📸 Screenshot saved: PDF_BOOKING_PAGE_${pnr}.png`);

    // 6. Remove blocking overlays and cookie banners via JavaScript
    console.log("   🔄 Removing overlays and cookie banners...");

    // Accept/dismiss cookie consent first
    try {
      const cookieSelectors = [
        "#onetrust-accept-btn-handler",
        'button:has-text("Accept")',
        'button:has-text("Accept all")',
        'button:has-text("Accept cookies")',
        'button:has-text("I accept")',
        'button:has-text("OK")',
        '[data-testid="accept-cookies"]',
        ".cookie-accept",
      ];

      for (const sel of cookieSelectors) {
        try {
          const cookieBtn = await targetPage.$(sel);
          if (cookieBtn && (await cookieBtn.isVisible())) {
            await cookieBtn.click({ force: true, timeout: 3000 });
            console.log(`   ✓ Clicked cookie accept: ${sel}`);
            await targetPage.waitForTimeout(1000);
            break;
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Remove all overlays, banners, and fixed elements via JavaScript
    await targetPage.evaluate(() => {
      // Cookie banners
      const cookieSelectors = [
        "#onetrust-banner-sdk",
        "#onetrust-consent-sdk",
        ".cookie-banner",
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[class*="consent"]',
        '[id*="consent"]',
      ];

      cookieSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          el.remove();
        });
      });

      // Known overlay classes
      const overlayClasses = [
        "bbe73dce14",
        "dc7e768484",
        "modal-backdrop",
        "overlay",
        "bui-modal",
        "popup",
      ];
      overlayClasses.forEach((cls) => {
        document.querySelectorAll(`.${cls}`).forEach((el) => {
          el.remove();
        });
      });

      // Remove fixed position elements (except main content)
      document.querySelectorAll("*").forEach((el) => {
        const style = window.getComputedStyle(el);
        if (
          style.position === "fixed" &&
          !el.classList.contains("main-content")
        ) {
          el.remove();
        }
      });

      // Remove sticky elements
      document.querySelectorAll('[style*="position: sticky"]').forEach((el) => {
        el.remove();
      });
    });
    await targetPage.waitForTimeout(500);

    // 7. Find and click "Print full version" button
    console.log('\n📄 Looking for "Print full version" button...');

    const printSelectors = [
      'button:has-text("Print full version")',
      'a:has-text("Print full version")',
      'button:has-text("Print confirmation")',
      'a:has-text("Print confirmation")',
      '[data-testid="print-confirmation"]',
      '[data-testid="print-button"]',
    ];

    let printBtn = null;
    for (const sel of printSelectors) {
      try {
        printBtn = await targetPage.$(sel);
        if (printBtn && (await printBtn.isVisible())) {
          console.log(`   ✓ Found: ${sel}`);
          break;
        }
        printBtn = null;
      } catch (e) {}
    }

    const finalPdfPath = path.join(DOWNLOADS_DIR, `Booking_${pnr}.pdf`);

    if (printBtn) {
      // Wait for new page when clicking print
      const printPagePromise = context
        .waitForEvent("page", { timeout: 15000 })
        .catch(() => null);

      // Click with force and fallback to JS click
      try {
        await printBtn.click({ force: true, timeout: 10000 });
        console.log('   ✓ Clicked "Print full version"');
      } catch (e) {
        console.log("   ⚠️ Force click failed, trying JS click...");
        await targetPage.evaluate((btn) => btn.click(), printBtn);
        console.log("   ✓ Clicked via JavaScript");
      }

      await targetPage.waitForTimeout(3000);

      const printPage = await printPagePromise;

      if (printPage) {
        console.log("   ✓ Print preview page opened");
        await printPage.waitForLoadState("domcontentloaded");
        await printPage.waitForTimeout(2000);

        // Generate PDF
        await printPage.pdf({
          path: finalPdfPath,
          format: "A4",
          printBackground: true,
          margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
        });

        console.log(`\n✅ PDF saved: ${finalPdfPath}`);
        await printPage.close().catch(() => {});
      } else {
        // Generate from current page
        console.log(
          "   ℹ️ No print page opened, generating from booking page..."
        );
        await targetPage.pdf({
          path: finalPdfPath,
          format: "A4",
          printBackground: true,
          margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
        });
        console.log(`\n✅ PDF saved: ${finalPdfPath}`);
      }
    } else {
      console.log('   ⚠️ "Print full version" button not found');
      console.log("   📄 Generating PDF from booking page as fallback...");

      await targetPage.pdf({
        path: finalPdfPath,
        format: "A4",
        printBackground: true,
        margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
      });
      console.log(`\n✅ Fallback PDF saved: ${finalPdfPath}`);
    }

    // 8. Send email if provided
    if (clientEmail) {
      console.log(`\n📧 Sending PDF to ${clientEmail}...`);
      try {
        const emailSent = await sendTicketEmail(
          clientEmail,
          "Valued Guest",
          finalPdfPath
        );
        if (emailSent) {
          console.log("✅ Email sent successfully!");
        } else {
          console.log("⚠️ Email sending returned false");
        }
      } catch (e) {
        console.log(`⚠️ Email error: ${e.message}`);
      }
    }

    console.log("\n" + "═".repeat(60));
    console.log("✅ COMPLETED");
    console.log("═".repeat(60));
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (page) {
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, "PDF_DOWNLOAD_ERROR.png"),
      });
    }
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Browser closed");
    }
  }
}

// Get args
const args = process.argv.slice(2);
const pnr = args[0] || "5886731939";
const email = args[1] || null;

// Connect to MongoDB and run
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // Try to get email from booking if not provided
    let clientEmail = email;
    if (!clientEmail) {
      const booking = await Booking.findOne({ pnr });
      if (booking) {
        clientEmail = booking.email;
        console.log(`📧 Found email in DB: ${clientEmail}`);
      }
    }

    await downloadBookingPDF(pnr, clientEmail);
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ MongoDB error:", err.message);
    process.exit(1);
  });
