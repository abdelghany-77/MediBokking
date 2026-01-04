import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  BASE_URL: "https://www.nouvelair.com",
  BOOKING_PAGE: "https://www.nouvelair.com/en/reservation",
  VIEWPORT: { width: 1920, height: 1080 },
  TIMEOUT: 60000,
  NAVIGATION_TIMEOUT: 60000,
  SCREENSHOTS_DIR: "./screenshots",
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  HEADLESS: true,
  // BRIGHTDATA PROXY CONFIGURATION
  PROXY: {
    enabled: false,
    server: "http://brd.superproxy.io:33335",
    username: "brd-customer-hl_551e92f2-zone-residential_proxy1",
    password: "0p65a85vctvf",
  },
  // 2CAPTCHA CONFIGURATION
  CAPTCHA: {
    apiKey: "8673ea9a63d80dae929ccf64795b5e86",
    siteKey: "6LdyC2cUAAAAAE8mRt01xdlE1WLKqmTG2lSJoIa9",
    pageUrl: "https://www.nouvelair.com/en",
  },
};

function ensureScreenshotsDir() {
  if (!fs.existsSync(CONFIG.SCREENSHOTS_DIR)) {
    fs.mkdirSync(CONFIG.SCREENSHOTS_DIR, { recursive: true });
  }
}

async function safeGoto(page, url) {
  for (let i = 1; i <= 3; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      return;
    } catch (e) {
      if (i === 3) throw e;
      await page.waitForTimeout(3000);
    }
  }
}

async function killPopups(page) {
  const selectors = ['button:has-text("Accept")', 'button:has-text("Agree")'];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForTimeout(1000);
        return;
      }
    } catch (e) {}
  }
}

async function captureScreenshot(page, step) {
  ensureScreenshotsDir();
  const filename = `NOUVELAIR_${step}_${Date.now()}.png`;
  const filepath = path.join(CONFIG.SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  📸 ${filepath}`);
  return filepath;
}

// ============================================================================
// HUMAN BEHAVIOR SIMULATION
// ============================================================================

function randomDelay(min = 500, max = 2000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(page, min = 500, max = 2000) {
  const delay = randomDelay(min, max);
  await page.waitForTimeout(delay);
}

async function humanMouseMove(page) {
  const viewport = page.viewportSize();
  const steps = Math.floor(Math.random() * 3) + 2;

  for (let i = 0; i < steps; i++) {
    const x = Math.floor(Math.random() * (viewport.width - 100)) + 50;
    const y = Math.floor(Math.random() * (viewport.height - 100)) + 50;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
    await humanDelay(page, 100, 300);
  }
}

async function humanScroll(page) {
  const scrollAmount = Math.floor(Math.random() * 300) + 100;
  const direction = Math.random() > 0.3 ? 1 : -1;
  await page.mouse.wheel(0, scrollAmount * direction);
  await humanDelay(page, 200, 500);
}

async function humanBehavior(page) {
  const actions = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < actions; i++) {
    if (Math.random() > 0.5) {
      await humanMouseMove(page);
    } else {
      await humanScroll(page);
    }
  }
}

async function humanClick(page, locator) {
  const box = await locator.boundingBox();
  if (box) {
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    await page.mouse.move(targetX, targetY, {
      steps: Math.floor(Math.random() * 15) + 10,
    });
    await humanDelay(page, 50, 150);

    await page.mouse.down();
    await humanDelay(page, 50, 100);
    await page.mouse.up();
  } else {
    await locator.click();
  }
}

async function humanType(page, locator, text) {
  await locator.click();
  await humanDelay(page, 100, 300);

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(50, 150) });
    if (Math.random() > 0.8) {
      await humanDelay(page, 100, 300);
    }
  }
}

// ============================================================================
// 2CAPTCHA RECAPTCHA V3 SOLVER
// ============================================================================

async function solve2CaptchaV3(action = "submit") {
  const apiKey = CONFIG.CAPTCHA.apiKey;
  const siteKey = CONFIG.CAPTCHA.siteKey;
  const pageUrl = CONFIG.CAPTCHA.pageUrl;

  console.log("🔐 [2Captcha] Requesting reCAPTCHA v3 token...");

  try {
    // Step 1: Submit captcha request
    const submitUrl = `http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${pageUrl}&version=v3&action=${action}&min_score=0.7&json=1`;

    const submitResponse = await fetch(submitUrl);
    const submitData = await submitResponse.json();

    if (submitData.status !== 1) {
      console.error("❌ [2Captcha] Submit failed:", submitData);
      return null;
    }

    const taskId = submitData.request;
    console.log(`   📋 Task ID: ${taskId}`);

    // Step 2: Poll for result (max 120 seconds)
    const maxAttempts = 24;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const resultUrl = `http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
      const resultResponse = await fetch(resultUrl);
      const resultData = await resultResponse.json();

      if (resultData.status === 1) {
        console.log("   ✅ [2Captcha] Token received!");
        return resultData.request;
      } else if (resultData.request !== "CAPCHA_NOT_READY") {
        console.error("❌ [2Captcha] Error:", resultData);
        return null;
      }

      console.log(`   ⏳ [2Captcha] Waiting... (${(i + 1) * 5}s)`);
    }

    console.error("❌ [2Captcha] Timeout waiting for solution");
    return null;
  } catch (error) {
    console.error("❌ [2Captcha] Error:", error.message);
    return null;
  }
}

async function injectRecaptchaToken(page, token) {
  if (!token) return false;

  console.log("   💉 Injecting reCAPTCHA token into page...");

  try {
    await page.evaluate((token) => {
      // Find and set the reCAPTCHA response textarea
      const textareas = document.querySelectorAll(
        'textarea[name="g-recaptcha-response"]'
      );
      textareas.forEach((textarea) => {
        textarea.value = token;
        textarea.style.display = "block";
      });

      // Also try to set it via grecaptcha callback if available
      if (window.grecaptcha && window.grecaptcha.enterprise) {
        // For enterprise reCAPTCHA
        console.log("Enterprise reCAPTCHA detected");
      }

      // Trigger any callback that might be listening
      const event = new Event("change", { bubbles: true });
      textareas.forEach((textarea) => textarea.dispatchEvent(event));
    }, token);

    console.log("   ✅ Token injected successfully");
    return true;
  } catch (error) {
    console.error("   ❌ Token injection failed:", error.message);
    return false;
  }
}

async function fillMuiAutocomplete(page, code, label) {
  console.log(`\n[${label}] ${code}`);

  const muiInputs = await page.locator(".MuiAutocomplete-input").all();
  const idx = label === "From" ? 0 : 1;

  if (muiInputs[idx]) {
    await muiInputs[idx].click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.type(code, { delay: 150 });
    await page.waitForTimeout(2000);

    const optionSelectors = [
      `.MuiAutocomplete-option:has-text("${code}")`,
      'li[role="option"]:first-child',
    ];

    for (const sel of optionSelectors) {
      try {
        const opt = page.locator(sel).first();
        if (await opt.isVisible({ timeout: 2000 })) {
          await opt.click();
          console.log(`  ✓ Selected`);
          return;
        }
      } catch (e) {}
    }

    await page.keyboard.press("Enter");
    console.log(`  ✓ Entered`);
  }
}

async function selectDateInCalendar(page, dateObj) {
  console.log(`\n[Date] ${dateObj.toDateString()}`);

  const day = dateObj.getDate();
  const month = dateObj.getMonth();
  const year = dateObj.getFullYear();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const targetMonth = `${monthNames[month]} ${year}`;

  // Open calendar
  const dateInputs = await page
    .locator('input[placeholder*="Departure"]')
    .all();
  if (dateInputs[0]) {
    await dateInputs[0].click();
    await page.waitForTimeout(1500);
  }

  // Navigate to target month
  for (let i = 0; i < 12; i++) {
    const header = page.locator(`text="${targetMonth}"`).first();
    if (await header.isVisible({ timeout: 1000 })) break;

    try {
      await page.locator('button:has-text("›")').first().click();
      await page.waitForTimeout(300);
    } catch (e) {
      break;
    }
  }

  // Click day
  const daySelectors = [
    `button.MuiPickersDay-root:has-text("${day}"):not([disabled])`,
    `button:text-is("${day}")`,
  ];

  for (const sel of daySelectors) {
    try {
      const days = await page.locator(sel).all();
      for (const dayBtn of days) {
        const classes = (await dayBtn.getAttribute("class")) || "";
        if (!classes.includes("outsideCurrentMonth")) {
          await dayBtn.click();
          console.log(`  ✓ Day ${day} selected`);
          await page.waitForTimeout(1000);
          return;
        }
      }
    } catch (e) {}
  }
}

/**
 * Select passenger counts (Adults, Children, Infants)
 * Based on booking.passengersList or default counts
 */
async function selectPassengerCounts(page, booking) {
  // Calculate passenger counts from passengersList
  let adults = 1;
  let children = 0;
  let infants = 0;

  if (booking.passengersList && booking.passengersList.length > 0) {
    // Count passengers by type based on age/DOB if available
    adults = booking.passengersList.length; // Default all to adults

    // If specific counts are provided in booking object
    if (booking.adults !== undefined) adults = booking.adults;
    if (booking.children !== undefined) children = booking.children;
    if (booking.infants !== undefined) infants = booking.infants;
  }

  // If only 1 adult and no children/infants, skip (default already selected)
  if (adults === 1 && children === 0 && infants === 0) {
    console.log("\\n[Passengers] Default 1 Adult - skipping selection");
    return;
  }

  console.log(
    `[Passengers] Selecting: ${adults} Adults, ${children} Children, ${infants} Infants`
  );

  try {
    // Click on the Passengers field to open the dropdown
    const passengersField = page
      .locator('.passenger-input, [class*="passenger"]')
      .first();

    // Try different selectors for the passenger field
    const passengerSelectors = [
      "text=Passengers",
      ".passenger-input",
      '[class*="passenger-container"]',
      ".stepper-value",
    ];

    let opened = false;
    for (const sel of passengerSelectors) {
      try {
        const field = page.locator(sel).first();
        if (await field.isVisible({ timeout: 2000 })) {
          await humanClick(page, field);
          await humanDelay(page, 500, 1000);
          opened = true;
          break;
        }
      } catch (e) {}
    }

    if (!opened) {
      console.log("   ⚠️ Could not find passengers field");
      return;
    }

    // Wait for the passenger popup to appear
    await page.waitForTimeout(1000);

    // Find the stepper containers
    const stepperContainers = await page.locator(".stepper-container").all();

    if (stepperContainers.length >= 3) {
      // Adults stepper (first container) - need to click + (adults - 1) times since default is 1
      const adultsToAdd = adults - 1;
      if (adultsToAdd > 0) {
        console.log(`   + Adding ${adultsToAdd} more adult(s)...`);
        const adultPlusBtn = stepperContainers[0].locator(
          'button[aria-label="decrease"]'
        ); // Note: labels are swapped in the HTML
        for (let i = 0; i < adultsToAdd; i++) {
          if (await adultPlusBtn.isVisible()) {
            await humanClick(page, adultPlusBtn);
            await humanDelay(page, 300, 500);
          }
        }
      }

      // Children stepper (second container)
      if (children > 0) {
        console.log(`   + Adding ${children} child(ren)...`);
        const childPlusBtn = stepperContainers[1].locator(
          'button[aria-label="decrease"]'
        );
        for (let i = 0; i < children; i++) {
          if (await childPlusBtn.isVisible()) {
            await humanClick(page, childPlusBtn);
            await humanDelay(page, 300, 500);
          }
        }
      }

      // Infants stepper (third container)
      if (infants > 0) {
        console.log(`   + Adding ${infants} infant(s)...`);
        const infantPlusBtn = stepperContainers[2].locator(
          'button[aria-label="decrease"]'
        );
        for (let i = 0; i < infants; i++) {
          if (await infantPlusBtn.isVisible()) {
            await humanClick(page, infantPlusBtn);
            await humanDelay(page, 300, 500);
          }
        }
      }
    } else {
      // Fallback: Try to find + buttons directly by looking at SVG paths
      console.log("   ℹ️ Using fallback button detection...");

      // The + button has the path with "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
      const plusButtons = await page
        .locator("button.MuiIconButton-root:not([disabled])")
        .all();

      let buttonIndex = 0;
      // Adults (skip first if already 1)
      for (let i = 0; i < adults - 1 && buttonIndex < plusButtons.length; i++) {
        await plusButtons[0].click();
        await humanDelay(page, 300, 500);
      }
    }

    // Click Continue button in the passenger popup
    await humanDelay(page, 500, 1000);
    const continueBtn = page
      .locator('.btn-passenger, button:has-text("Continue")')
      .first();
    if (await continueBtn.isVisible({ timeout: 3000 })) {
      await humanClick(page, continueBtn);
      console.log("   ✓ Passengers selected");
    }

    await humanDelay(page, 500, 1000);
  } catch (error) {
    console.log(`   ⚠️ Error selecting passengers: ${error.message}`);
  }
}

/**
 * ============================================================================
 * MAIN BOOKING ENGINE
 * ============================================================================
 */

export async function automateNouvelairBooking(booking) {
  ensureScreenshotsDir();
  const flightDate = new Date(booking.flightDate);
  const returnDate = booking.returnDate ? new Date(booking.returnDate) : null;
  const nights = returnDate
    ? Math.ceil((returnDate - flightDate) / (1000 * 60 * 60 * 24))
    : 0;
  let browser, page;

  try {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🚀 NOUVELAIR COMPLETE AUTOMATION (SERVER MODE)");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`Booking: ${booking._id}`);
    console.log(
      `Route: ${booking.departureAirport} → ${booking.arrivalAirport}`
    );
    console.log(`Date: ${new Date(booking.flightDate).toDateString()}`);
    console.log(
      `Return: ${
        booking.returnDate
          ? new Date(booking.returnDate).toDateString()
          : "One-way"
      }`
    );
    console.log(
      `Proxy: ${CONFIG.PROXY.enabled ? "✅ BrightData Enabled" : "❌ Disabled"}`
    );
    console.log(
      "═══════════════════════════════════════════════════════════\n"
    );

    const isRoundTrip = !!booking.returnDate;
    const passengers = booking.passengersList || [
      {
        clientName: booking.clientName,
        passportNumber: booking.passportNumber,
        passengerDOB: booking.passengerDOB,
      },
    ];

    // ✅ INIT WITH STEALTH ARGS FOR SERVER + PROXY
    const launchOptions = {
      headless: CONFIG.HEADLESS,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--window-position=0,0",
        "--ignore-certifcate-errors",
        "--ignore-certifcate-errors-spki-list",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        `--user-agent=${CONFIG.USER_AGENT}`,
      ],
    };

    // Add proxy if enabled
    if (CONFIG.PROXY.enabled) {
      launchOptions.proxy = {
        server: CONFIG.PROXY.server,
        username: CONFIG.PROXY.username,
        password: CONFIG.PROXY.password,
      };
      console.log(`🌐 Using BrightData Proxy: ${CONFIG.PROXY.server}`);
    }

    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      viewport: CONFIG.VIEWPORT,
      userAgent: CONFIG.USER_AGENT,
      locale: "en-US",
      timezoneId: "Africa/Tunis",
      permissions: ["geolocation"],
    });

    // Mask WebDriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    page = await context.newPage();
    page.setDefaultTimeout(CONFIG.TIMEOUT);

    // ========================================================================
    // STEP 1: HOMEPAGE & SEARCH
    // ========================================================================
    console.log("\n[STEP 1] Navigate & Search");
    await safeGoto(page, CONFIG.BOOKING_PAGE);
    await killPopups(page);
    await humanDelay(page, 2000, 4000);

    // Add human behavior to build reCAPTCHA score
    console.log("   Simulating human behavior...");
    await humanBehavior(page);
    await humanMouseMove(page);

    // Trip type
    const tripSel = isRoundTrip
      ? 'label:has-text("Round Trip")'
      : 'label:has-text("One way")';
    try {
      const tripTypeBtn = page.locator(tripSel).first();
      await humanClick(page, tripTypeBtn);
      await humanDelay(page, 400, 800);
    } catch (e) {}

    // Airports
    await fillMuiAutocomplete(page, booking.departureAirport, "From");
    await humanDelay(page, 800, 1500);
    await humanBehavior(page);
    await fillMuiAutocomplete(page, booking.arrivalAirport, "To");
    await humanDelay(page, 800, 1500);

    // Date
    await selectDateInCalendar(page, new Date(booking.flightDate));
    await humanBehavior(page);

    if (isRoundTrip) {
      await selectDateInCalendar(page, new Date(booking.returnDate));
    }

    // Human behavior before search
    await humanMouseMove(page);
    await humanDelay(page, 500, 1000);

    // Select number of passengers (Adults, Children, Infants)
    await selectPassengerCounts(page, booking);

    await captureScreenshot(page, "SEARCH_PAGE");

    // Search
    const searchBtn = page.locator('button:has-text("SEARCH")').first();
    await humanClick(page, searchBtn);
    console.log("  ✓ Search submitted");
    await humanDelay(page, 6000, 10000);
    await killPopups(page);

    // ========================================================================
    // STEP 2: SELECT FLIGHTS
    // ========================================================================
    console.log("[STEP 2] Select Flights (Force Mode)");

    // ------------------------------------------------------------------------
    // 1.(OUTBOUND)
    // ------------------------------------------------------------------------
    console.log("   ✈️ Selecting OUTBOUND Flight...");

    const outboundBlock = page
      .locator(".offer-info-block.cabin-name-ECONOMY")
      .first();

    try {
      console.log("   [Action] Waiting for Outbound attached...");
      await outboundBlock.waitFor({ state: "attached", timeout: 30000 });

      console.log("   [Action] JS Clicking Outbound...");
      await outboundBlock.evaluate((el) => el.click());

      await page.waitForTimeout(3000);

      console.log("   [Action] Selecting Outbound Light Package...");
      await page.waitForSelector('button:has-text("TND")', {
        state: "attached",
        timeout: 20000,
      });

      const lightBtnOut = page
        .locator('div:has-text("Travel light") button:has-text("TND")')
        .last();

      if ((await lightBtnOut.count()) > 0) {
        await lightBtnOut.evaluate((el) => el.click());
      } else {
        await page
          .locator(".cabin-selection-button")
          .first()
          .evaluate((el) => el.click());
      }

      console.log("   ⏳ Waiting for animation...");
      await page.waitForTimeout(4000);
    } catch (e) {
      console.error("❌ Error selecting outbound:", e.message);
      throw e;
    }

    // ------------------------------------------------------------------------
    // 2.(RETURN)
    // ------------------------------------------------------------------------
    if (isRoundTrip) {
      console.log("   🔄 Selecting RETURN Flight...");

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      const inboundBlock = page
        .locator("#journeySection-1 .offer-info-block.cabin-name-ECONOMY")
        .first();

      try {
        console.log("   [Action] Waiting for Return attached...");
        await inboundBlock.waitFor({ state: "attached", timeout: 30000 });

        console.log("   [Action] JS Clicking Return...");
        await inboundBlock.evaluate((el) => el.click());

        await page.waitForTimeout(3000);

        console.log("   [Action] Selecting Return Light Package...");

        const lightBtnRet = page
          .locator('div:has-text("Travel light") button:has-text("TND")')
          .last();

        await lightBtnRet.waitFor({ state: "attached", timeout: 10000 });
        await lightBtnRet.evaluate((el) => el.click());

        await page.waitForTimeout(2000);
      } catch (e) {
        console.error("❌ Error selecting inbound:", e.message);
        await captureScreenshot(page, "ERROR_INBOUND_SELECTION");
        throw e;
      }
    }

    // ------------------------------------------------------------------------
    // 3.(CONTINUE)
    // ------------------------------------------------------------------------
    console.log("   [Action] Clicking Continue...");
    const continueBtn = page.locator("#continueButton");

    try {
      await continueBtn.waitFor({ state: "attached", timeout: 10000 });
      await continueBtn.evaluate((el) => el.click());
    } catch (e) {
      console.log("Warning: Continue button issue");
    }

    // ========================================================================
    // STEP 3: PASSENGER INFORMATION
    // ========================================================================
    console.log("\n[STEP 3] Passenger Information");
    await page.waitForTimeout(2000);
    await captureScreenshot(page, "PASSENGER_FORM");

    let firstName = "Guest";
    let lastName = "User";
    if (booking.clientName) {
      const nameParts = booking.clientName.trim().split(" ");
      if (nameParts.length > 1) {
        lastName = nameParts.pop();
        firstName = nameParts.join(" ");
      } else {
        firstName = nameParts[0];
      }
    }

    const userData = {
      title: "Mr.",
      firstName: firstName,
      lastName: lastName,
      nationality: booking.country || "Tunisia",
      email: booking.email,
      phone: booking.phone,
      country: booking.country || "Tunisia",
      city: "Tunis",
      zip: "1000",
    };

    console.log("📝 Dynamic User Data Prepared:", userData);

    try {
      // =========================================================
      // Stage 1 (Identity) - Fill ALL passengers
      // =========================================================
      console.log("  [Stage 1] Filling Passenger Identities...");

      await page
        .locator(".form-box, .passenger-identity-section")
        .first()
        .waitFor({ state: "visible", timeout: 30000 });

      // Loop through all passengers - website shows ONE passenger at a time
      for (let i = 0; i < passengers.length; i++) {
        const passenger = passengers[i];
        console.log(
          `\n    📋 Filling Passenger ${i + 1} of ${passengers.length}...`
        );

        // Parse passenger name
        let pFirstName = "Guest";
        let pLastName = "User";
        const passengerName =
          passenger.clientName || passenger.name || booking.clientName;
        if (passengerName) {
          const nameParts = passengerName.trim().split(" ");
          if (nameParts.length > 1) {
            pLastName = nameParts.pop();
            pFirstName = nameParts.join(" ");
          } else {
            pFirstName = nameParts[0];
          }
        }

        const pNationality =
          passenger.nationality ||
          passenger.country ||
          booking.country ||
          "Tunisia";
        const pTitle = passenger.title || "Mr.";

        console.log(
          `       Name: ${pFirstName} ${pLastName}, Nationality: ${pNationality}`
        );

        // Wait for the form to be visible for current passenger
        await page.waitForTimeout(2000);

        // Each passenger has different form IDs: _0 for first, _1 for second, etc.
        const formIndex = i;

        // Select Title for this passenger
        const titleButton = page.locator(
          `button[data-id="passenger_form_validate__title_${formIndex}"]`
        );
        if (await titleButton.isVisible({ timeout: 5000 })) {
          await titleButton.click();
          await humanDelay(page, 800, 1200);

          // Click on the title option directly using the dropdown near this button
          const mrOption = page
            .locator('li a:has-text("Mr.")')
            .filter({ visible: true })
            .first();
          const mrsOption = page
            .locator('li a:has-text("Mrs.")')
            .filter({ visible: true })
            .first();

          if (pTitle.includes("Mrs") || pTitle.includes("Miss")) {
            if (await mrsOption.isVisible({ timeout: 2000 })) {
              await mrsOption.click();
            }
          } else {
            if (await mrOption.isVisible({ timeout: 2000 })) {
              await mrOption.click();
            }
          }
          await humanDelay(page, 300, 500);
        }

        // Fill First Name
        const nameInput = page.locator(
          `#passenger_form_validate__name_${formIndex}`
        );
        if (await nameInput.isVisible({ timeout: 3000 })) {
          await nameInput.fill(pFirstName);
          await humanDelay(page, 200, 400);
        }

        // Fill Last Name
        const surnameInput = page.locator(
          `#passenger_form_validate__surname_${formIndex}`
        );
        if (await surnameInput.isVisible({ timeout: 3000 })) {
          await surnameInput.fill(pLastName);
          await humanDelay(page, 200, 400);
        }

        // Select Nationality
        const natButton = page.locator(
          `button[data-id="passenger_form_validate__nationality_${formIndex}"]`
        );
        if (await natButton.isVisible({ timeout: 3000 })) {
          await natButton.scrollIntoViewIfNeeded();
          await natButton.click();
          await humanDelay(page, 800, 1200);

          // Find the visible search input in the dropdown
          const natSearch = page
            .locator(".bs-searchbox input")
            .filter({ visible: true })
            .first();
          if (await natSearch.isVisible({ timeout: 3000 })) {
            await natSearch.fill(pNationality);
            await humanDelay(page, 500, 800);
            await page.keyboard.press("Enter");
          }
          await humanDelay(page, 300, 500);
        }

        // Mark first passenger as contact person
        if (i === 0) {
          console.log("       ✓ Setting as contact person...");
          const contactLabel = page.locator(
            'label[for="passenger_form_validate__contact_person_0"]'
          );
          if (await contactLabel.isVisible({ timeout: 2000 })) {
            await contactLabel.click();
          }
        }

        console.log(`       ✓ Passenger ${i + 1} identity filled`);

        // After filling each passenger, click the appropriate button
        await humanBehavior(page);
        await humanDelay(page, 500, 1000);

        if (i < passengers.length - 1) {
          // Not the last passenger - click "Adult N" button to go to next passenger
          const nextPassengerNum = i + 2; // Adult 2, Adult 3, etc.
          console.log(
            `       → Clicking "Adult ${nextPassengerNum}" to proceed...`
          );

          // Look for the button with "Adult N" text in the span
          const adultButton = page
            .locator(
              `.js-passenger-continue-button span:has-text("Adult ${nextPassengerNum}")`
            )
            .first();

          if (await adultButton.isVisible({ timeout: 5000 })) {
            // Click the parent anchor element
            const parentBtn = page
              .locator(
                `a.js-passenger-continue-button:has(span:has-text("Adult ${nextPassengerNum}"))`
              )
              .first();
            await humanClick(page, parentBtn);
            console.log(`       ✓ Navigated to Adult ${nextPassengerNum}`);
          } else {
            // Fallback: try clicking the continue button
            const continueBtn = page
              .locator(".js-passenger-continue-button")
              .filter({ visible: true })
              .first();
            if (await continueBtn.isVisible()) {
              await humanClick(page, continueBtn);
            }
          }

          await humanDelay(page, 1500, 2500);
        }
      }

      console.log("\\n    - Clicking first Continue...");

      // Add human behavior before first continue
      await humanBehavior(page);
      await humanDelay(page, 500, 1000);

      const firstContinue = page
        .locator(".js-passenger-continue-button")
        .filter({ visible: true })
        .first();

      await firstContinue.scrollIntoViewIfNeeded();
      await humanDelay(page, 800, 1500);
      await humanClick(page, firstContinue);

      await humanDelay(page, 1500, 2500);

      // =========================================================
      // Stage 2 (Contact Info)
      // =========================================================
      console.log("  [Stage 2] Filling Contact Information...");
      await captureScreenshot(page, "PASSENGER_FORM2");

      await page
        .locator('input[type="email"], input[type="tel"]')
        .first()
        .waitFor({ state: "visible", timeout: 15000 });

      let cleanPhone = userData.phone.replace(/\D/g, "");
      if (cleanPhone.startsWith("216")) cleanPhone = cleanPhone.substring(3);
      if (cleanPhone.startsWith("00216")) cleanPhone = cleanPhone.substring(5);

      console.log(`    - Typing Phone Number: ${cleanPhone}`);

      const phoneInputs = await page.locator('input[type="tel"]').all();
      for (const input of phoneInputs) {
        if (await input.isVisible()) {
          await input.click();
          await page.waitForTimeout(500);
          await input.type(cleanPhone, { delay: 150 });
        }
      }

      console.log(`    - Typing Email: ${userData.email}`);

      const emailInput = page
        .locator('input[type="email"], input[name*="email"]')
        .filter({ visible: true })
        .first();

      if (await emailInput.isVisible()) {
        await emailInput.click();
        await emailInput.clear();
        await emailInput.fill(userData.email);
      } else {
        console.error("  ⚠️ Email field not found!");
      }

      const countryBtn = page.locator(".bootstrap-select > button").last();
      if (
        (await countryBtn.isVisible()) &&
        (await countryBtn.innerText()).includes("Select")
      ) {
        console.log(`    - Selecting Country: ${userData.country}`);
        await countryBtn.click();
        const countrySearch = page
          .locator(".bs-searchbox input")
          .filter({ visible: true });
        await countrySearch.fill(userData.country);
        await page.keyboard.press("Enter");
      }

      await captureScreenshot(page, "PASSENGER_after_fill_FORM2");

      console.log(
        "    - Preparing for final Continue (reCAPTCHA protected)..."
      );

      // =====================================================================
      // EXTENSIVE HUMAN BEHAVIOR BEFORE RECAPTCHA-PROTECTED ACTION
      // =====================================================================
      console.log("    🧑 Simulating extensive human behavior...");

      // Random scrolling like a user reviewing the form
      await humanScroll(page);
      await humanDelay(page, 1000, 2000);

      // Move mouse around naturally
      await humanMouseMove(page);
      await humanDelay(page, 500, 1000);

      // Scroll back up to see form
      await page.mouse.wheel(0, -200);
      await humanDelay(page, 500, 1000);

      // More random movements
      await humanBehavior(page);
      await humanDelay(page, 1000, 2000);

      // =====================================================================
      // 2CAPTCHA RECAPTCHA V3 SOLVING
      // =====================================================================
      console.log("    🔐 Solving reCAPTCHA v3 via 2Captcha...");

      const recaptchaToken = await solve2CaptchaV3("passenger_continue");

      if (recaptchaToken) {
        console.log("    ✅ Got reCAPTCHA token, injecting...");
        await injectRecaptchaToken(page, recaptchaToken);
        await humanDelay(page, 500, 1000);
      } else {
        console.log(
          "    ⚠️ No token received, proceeding with human behavior only..."
        );
      }

      // =====================================================================
      // CLICK CONTINUE WITH HUMAN-LIKE BEHAVIOR
      // =====================================================================
      console.log("    - Clicking final Continue...");

      const finalContinue = page
        .locator(".js-passenger-continue-button")
        .filter({ visible: true })
        .last();

      await finalContinue.scrollIntoViewIfNeeded();
      await humanDelay(page, 800, 1500);

      // Final human movements before click
      await humanMouseMove(page);
      await humanDelay(page, 300, 600);

      // Click with human behavior
      await humanClick(page, finalContinue);
    } catch (error) {
      console.error("❌ Error in Step 3:", error);
      await page.screenshot({
        path: `screenshots/ERROR_STEP3_${Date.now()}.png`,
      });
      throw error;
    }

    // ========================================================================
    // STEP 4: SKIP SERVICES
    // ========================================================================
    console.log("\n[STEP 4] Skipping Services (Seat, Baggage, Other)");
    await page.waitForTimeout(3000);
    await captureScreenshot(page, "PASSENGER_sitting_baggage");
    await killPopups(page);

    const handleServiceTab = async (tabName) => {
      console.log(`   Processing ${tabName}...`);
      await page.waitForTimeout(1500);
      try {
        const flight2Btn = page
          .locator("button")
          .filter({ hasText: /Flight 2|Vol 2/i })
          .last();
        if (await flight2Btn.isVisible({ timeout: 2000 })) {
          console.log(
            `     ➜ [${tabName}] Found 'Flight 2' button. Clicking...`
          );
          await flight2Btn.click();
          await page.waitForTimeout(2000);
        }
        const continueBtn = page
          .locator("button")
          .filter({ hasText: "Continue" })
          .last();

        if (await continueBtn.isVisible({ timeout: 5000 })) {
          console.log(`     ✓ [${tabName}] Clicking Continue...`);
          await continueBtn.click();
          await page.waitForTimeout(2000);
        } else {
          console.log(
            `     ℹ️ [${tabName}] Continue button not found (might have moved automatically).`
          );
        }
      } catch (e) {
        console.log(`     ⚠️ Note on ${tabName}: ${e.message}`);
        try {
          console.log("     Trying generic bottom-right button fallback...");
          await page
            .locator(".ssr-bottom-button, .continue-btn")
            .last()
            .click({ force: true });
          await page.waitForTimeout(2000);
        } catch (err) {}
      }
    };

    await handleServiceTab("SEAT_SELECTION");
    await handleServiceTab("BAGGAGE_SELECTION");
    await handleServiceTab("OTHER_SERVICES");

    // ========================================================================
    // STEP 5: PAYMENT PAGE
    // ========================================================================
    console.log("\n[STEP 5] Payment Page");
    await page.waitForTimeout(5000);
    await captureScreenshot(page, "PAYMENT_PAGE_LOADED");

    let totalPrice = 0;
    let ticketCost = 0;
    let taxCost = 0;
    let surchargeCost = 0;

    try {
      console.log("   💰 Extracting price details...");

      // Extract total price from the data-price-value attribute (most reliable)
      const totalPriceElement = page
        .locator(".total-amount-basket-detail[data-price-value]")
        .first();
      if (await totalPriceElement.isVisible({ timeout: 5000 })) {
        const priceValue = await totalPriceElement.getAttribute(
          "data-price-value"
        );
        if (priceValue) {
          totalPrice = parseFloat(priceValue);
          console.log(`   ✓ Total Price: ${totalPrice} TND`);
        }
      }

      // Fallback: try to get from h3.full-price-total or text content
      if (!totalPrice) {
        const fallbackPrice = page
          .locator("h3.full-price-total, .full-price-total")
          .first();
        if (await fallbackPrice.isVisible({ timeout: 2000 })) {
          const priceText = await fallbackPrice.innerText();
          const cleanNumber = priceText.replace(/[^0-9.]/g, "").trim();
          if (cleanNumber) {
            totalPrice = parseFloat(cleanNumber);
            console.log(`   ✓ Total Price (fallback): ${totalPrice} TND`);
          }
        }
      }

      // Extract Ticket Cost
      const ticketRow = page.locator('th:has-text("Ticket Cost")').first();
      if (await ticketRow.isVisible({ timeout: 2000 })) {
        const ticketPriceCell = page
          .locator(
            'th:has-text("Ticket Cost") + td .price-detail-price, .base-fare-price span'
          )
          .first();
        if (await ticketPriceCell.isVisible()) {
          const ticketText = await ticketPriceCell.innerText();
          const cleanTicket = ticketText.replace(/[^0-9.]/g, "").trim();
          if (cleanTicket) {
            ticketCost = parseFloat(cleanTicket);
            console.log(`   ✓ Ticket Cost: ${ticketCost} TND`);
          }
        }
      }

      // Extract Tax Cost
      const taxRow = page
        .locator('th:has-text("Tax Cost"), .total-tax-title')
        .first();
      if (await taxRow.isVisible({ timeout: 2000 })) {
        const taxPriceCell = page
          .locator(
            'th:has-text("Tax Cost") + td .price-detail-price, .total-tax-price span'
          )
          .first();
        if (await taxPriceCell.isVisible()) {
          const taxText = await taxPriceCell.innerText();
          const cleanTax = taxText.replace(/[^0-9.]/g, "").trim();
          if (cleanTax) {
            taxCost = parseFloat(cleanTax);
            console.log(`   ✓ Tax Cost: ${taxCost} TND`);
          }
        }
      }

      // Extract Surcharge
      const surchargeRow = page
        .locator('th:has-text("Surcharge"), .total-surcharge-title')
        .first();
      if (await surchargeRow.isVisible({ timeout: 2000 })) {
        const surchargePriceCell = page
          .locator(
            'th:has-text("Surcharge") + td .price-detail-price, .total-surcharge-price'
          )
          .first();
        if (await surchargePriceCell.isVisible()) {
          const surchargeText = await surchargePriceCell.innerText();
          const cleanSurcharge = surchargeText.replace(/[^0-9.]/g, "").trim();
          if (cleanSurcharge) {
            surchargeCost = parseFloat(cleanSurcharge);
            console.log(`   ✓ Surcharge: ${surchargeCost} TND`);
          }
        }
      }
    } catch (e) {
      console.log(`   ⚠️ Failed to extract price details: ${e.message}`);
    }

    try {
      console.log("   💳 Selecting Payment Method...");

      const payLaterPanel = page.locator("#payLater-panel");

      if (await payLaterPanel.isVisible()) {
        console.log("   ✓ Found Pay Later panel");

        const clickableLabel = payLaterPanel
          .locator("label.form-check-label")
          .first();

        const isChecked = await payLaterPanel
          .locator(".icheckbox")
          .first()
          .getAttribute("class");

        if (!isChecked.includes("checked")) {
          console.log("   🖱️ Clicking Pay Later Checkbox...");
          await clickableLabel.click({ force: true });
          await page.waitForTimeout(2000);
        } else {
          console.log("   ✓ Pay Later already checked");
        }

        const specificSubmitBtn = payLaterPanel.locator(
          'form[action*="payLater"] input[type="submit"]'
        );

        if (await specificSubmitBtn.isVisible()) {
          console.log("   🎯 Found SPECIFIC 'Pay later' submit button");
          console.log("   🖱️ Clicking specific button to confirm booking...");

          await Promise.all([
            page
              .waitForNavigation({ timeout: 60000 })
              .catch(() =>
                console.log("   ℹ️ Navigation timeout or page loaded fast")
              ),
            specificSubmitBtn.click({ force: true }),
          ]);
        } else {
          console.error(
            "   ❌ CRITICAL: Checkbox clicked but 'Pay later' submit button did not appear!"
          );
          await captureScreenshot(page, "PAY_LATER_BUTTON_MISSING");

          const fallbackBtn = payLaterPanel
            .locator('input[value="Pay later"]')
            .first();
          if (await fallbackBtn.isVisible()) {
            await fallbackBtn.click({ force: true });
          }
        }
      } else {
        console.log(
          "   ⚠️ 'Pay Later' panel (#payLater-panel) NOT found in HTML."
        );
      }
    } catch (e) {
      console.log(`   ⚠️ Error in payment step: ${e.message}`);
    }

    // ========================================================================
    // STEP 6: EXTRACT PNR
    // ========================================================================
    console.log("\n[STEP 6] Extract PNR");
    await page.waitForTimeout(15000);

    try {
      await page.waitForSelector("text=Reference", { timeout: 10000 });
    } catch (e) {}

    await captureScreenshot(page, "CONFIRMATION_RESULT");

    let pnr = null;
    try {
      const bodyText = await page.innerText("body");

      if (
        bodyText.includes("Payment options") ||
        bodyText.includes("TOTAL PRICE")
      ) {
        console.log(
          "   ⚠️ Warning: Still seeing payment elements. Booking might have failed."
        );
      }

      const pnrPatterns = [
        /Reference\s*:\s*([A-Z0-9]{6})/i,
        /Booking ref\s*:\s*([A-Z0-9]{6})/i,
        /PNR\s*:\s*([A-Z0-9]{6})/i,
        /Code\s*:\s*([A-Z0-9]{6})/i,
      ];

      for (const pattern of pnrPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          pnr = match[1];
          break;
        }
      }

      if (!pnr) {
        const codeMatch = bodyText.match(/\b([A-Z0-9]{6})\b/);
        if (codeMatch && !codeMatch[1].match(/^\d+$/)) {
          pnr = codeMatch[1];
        }
      }
    } catch (e) {
      console.log("   ⚠️ Error extracting PNR text");
    }

    console.log("═══════════════════════════════════════════════════════════");
    if (pnr) {
      console.log(`✅ SUCCESS! PNR: ${pnr}`);
    } else {
      console.log(`❌ FAILED: No PNR found. (Price: ${totalPrice})`);
    }
    console.log("═══════════════════════════════════════════════════════════");

    await browser.close();

    return {
      success: !!pnr,
      status: pnr ? "Confirmed" : "Failed",
      pnr: pnr || "N/A",
      price: totalPrice || 0,
      ticketCost: ticketCost || 0,
      taxCost: taxCost || 0,
      surchargeCost: surchargeCost || 0,
      bookingId: booking._id,
      tripType: nights > 0 ? "Round-Trip" : "One-Way",
    };
  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);

    if (page) await captureScreenshot(page, "ERROR_FATAL");
    if (browser) await browser.close();

    throw error;
  }
}

export default automateNouvelairBooking;
