import "dotenv/config";
import { chromium } from "playwright";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MongoDB Connection URI
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/travel_automation";

// User Agent and headless config from env
const USER_AGENT =
  process.env.PLAYWRIGHT_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";

/**
 * Connect to MongoDB (if not already connected)
 */
async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return; // Already connected
  }
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
async function disconnectDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("📤 MongoDB disconnected");
    }
  } catch (error) {
    console.error("❌ MongoDB disconnect error:", error.message);
  }
}

/**
 * Format date for date picker (YYYY-MM-DD)
 */
function formatDate(date) {
  if (typeof date === "string") {
    return date.split("T")[0];
  }
  return date.toISOString().split("T")[0];
}

function makeTimestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDirExists(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    // ignore
  }
}

/**
 * Search and book a hotel on Booking.com
 * @param {Object} booking - Booking document from database
 * @returns {Promise<Object>} Updated booking object
 */
async function searchAndBookHotel(booking) {
  let browser;
  let context;

  // Use dates from booking object
  const checkIn = new Date(booking.checkInDate);
  const checkOut = new Date(booking.checkOutDate);
  const destination = booking.destination;

  // Calculate number of nights
  const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

  console.log("═".repeat(60));
  console.log("🏨 BOOKING ENGINE - Hotel Search & Reservation");
  console.log("═".repeat(60));
  console.log(`📋 Booking ID: ${booking._id}`);
  console.log(`👤 Client: ${booking.clientName}`);
  console.log(`📍 Destination: ${destination}`);
  console.log(`📅 Check-in: ${formatDate(checkIn)}`);
  console.log(`📅 Check-out: ${formatDate(checkOut)}`);
  console.log("═".repeat(60));

  try {
    // Connect to MongoDB
    await connectDB();

    // Launch browser
    console.log("🚀 Launching browser...");
    browser = await chromium.launch({
      headless: PLAYWRIGHT_HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // ---------------------------------------------------------
    //  START ACCOUNT ROTATION LOGIC
    // ---------------------------------------------------------

    const authDir = path.join(__dirname, "../../");
    let authFiles = [];
    try {
      authFiles = fs
        .readdirSync(authDir)
        .filter((file) => file.startsWith("auth") && file.endsWith(".json"));
    } catch (err) {
      console.log("⚠️ Error reading auth directory, verifying files...");
    }

    const contextOptions = {
      userAgent: USER_AGENT,
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
    };

    if (authFiles.length > 0) {
      const randomFile =
        authFiles[Math.floor(Math.random() * authFiles.length)];
      const fullPath = path.join(authDir, randomFile);

      try {
        const storageState = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        contextOptions.storageState = storageState;
        console.log(`🔐 ACCOUNT ROTATION: Active Session => '${randomFile}'`);
      } catch (e) {
        console.log(
          `⚠️ Failed to load selected auth file (${randomFile}), continuing as Guest.`
        );
      }
    } else {
      console.log(
        "⚠️ No auth files found (auth*.json), continuing without session"
      );
    }
    // ---------------------------------------------------------
    context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Navigate to Booking.com
    console.log("🌍 Navigating to Booking.com...");
    await page.goto("https://www.booking.com/index.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // ========== HANDLE POPUPS ==========
    console.log("🔄 Handling popups...");

    // Close Genius banner if present
    try {
      const geniusBanner = await page.$(
        '[aria-label="Dismiss sign-in info."], [data-testid="genius-banner-close"]'
      );
      if (geniusBanner) {
        await geniusBanner.click();
        console.log("   ✓ Closed Genius banner");
        await page.waitForTimeout(500);
      }
    } catch (e) {}

    // Close cookie banner if present
    try {
      const cookieBtn = await page.$(
        '#onetrust-accept-btn-handler, button:has-text("Accept")'
      );
      if (cookieBtn) {
        await cookieBtn.click();
        console.log("   ✓ Accepted cookies");
        await page.waitForTimeout(500);
      }
    } catch (e) {}

    // Close any overlay/modal
    try {
      const closeButtons = await page.$$(
        '[aria-label="Close"], [data-testid="header-close-button"]'
      );
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }
    } catch (e) {}

    // ========== SEARCH LOGIC ==========
    console.log("🔍 Entering destination...");

    // Click and clear search input
    const searchInput = 'input[name="ss"]';
    await page.waitForSelector(searchInput, { timeout: 10000 });
    await page.click(searchInput);
    await page.waitForTimeout(500);
    await page.fill(searchInput, "");
    await page.type(searchInput, destination, { delay: 100 });
    await page.waitForTimeout(2000);

    // Select autocomplete suggestion
    try {
      const autocomplete =
        '[data-testid="autocomplete-result"], [data-testid="autocomplete-results-options"] li';
      await page.waitForSelector(autocomplete, { timeout: 5000 });
      await page.click(autocomplete);
      console.log("   ✓ Selected autocomplete suggestion");
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log("   ⚠️ No autocomplete, continuing...");
    }

    // ========== DATE PICKER ==========
    console.log("📅 Opening date picker...");

    // Click on date field to open picker
    try {
      const dateField =
        '[data-testid="date-display-field-start"], [data-testid="searchbox-dates-container"], [data-testid="date-display-field-end"]';
      await page.click(dateField);
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log("   ⚠️ Date field click failed, trying alternative...");
    }

    // Navigate to correct month for check-in
    const checkInDay = checkIn.getDate();
    const checkOutDay = checkOut.getDate();
    const checkInMonthName = checkIn.toLocaleString("en-US", { month: "long" });
    const checkInYear = checkIn.getFullYear();

    console.log(`   📆 Looking for: ${checkInMonthName} ${checkInYear}`);

    // Take screenshot to debug calendar state
    await page.screenshot({ path: "screenshots/calendar_debug.png" });
    console.log("   📸 Debug screenshot: screenshots/calendar_debug.png");

    // Navigate calendar forward until the exact check-in date is present.
    // This avoids false matches like "February 2027" when we need "February 2026".
    const ensureDateVisible = async (isoDate) => {
      for (let i = 0; i < 24; i++) {
        const btn = await page.$(`[data-date="${isoDate}"]`);
        if (btn) return true;

        const nextBtnSelectors = [
          'button[aria-label="Next month"]',
          '[data-testid="searchbox-datepicker-next-button"]',
          ".bui-calendar__control--next",
          '[class*="calendar"] button[aria-label*="Next" i]',
        ];
        let clicked = false;
        for (const selector of nextBtnSelectors) {
          const nextBtn = await page.$(selector);
          if (nextBtn) {
            await nextBtn.click().catch(() => {});
            clicked = true;
            await page.waitForTimeout(350);
            break;
          }
        }
        if (!clicked) break;
      }
      return false;
    };

    await ensureDateVisible(formatDate(checkIn)).catch(() => {});

    // Select check-in date using multiple strategies
    console.log(`   📅 Selecting check-in: ${formatDate(checkIn)}`);
    try {
      // Strategy 1: Use data-date attribute
      const dateSelector1 = `[data-date="${formatDate(checkIn)}"]`;
      const dateBtn1 = await page.$(dateSelector1);
      if (dateBtn1) {
        await dateBtn1.click();
        console.log("   ✓ Check-in selected via data-date");
      } else {
        // Strategy 2: Find by aria-label
        const ariaSelectorYear = `[aria-label*="${checkInDay}"][aria-label*="${checkInMonthName}"][aria-label*="${checkInYear}"]`;
        const ariaSelector = `[aria-label*="${checkInDay}"][aria-label*="${checkInMonthName}"]`;
        const dateBtn2 =
          (await page.$(ariaSelectorYear)) || (await page.$(ariaSelector));
        if (dateBtn2) {
          await dateBtn2.click();
          console.log("   ✓ Check-in selected via aria-label");
        } else {
          // Strategy 3: Click by text content
          const daySpans = await page.$$(
            'span[data-date], td span, [class*="calendar"] span'
          );
          for (const span of daySpans) {
            const text = await span.textContent();
            if (text && text.trim() === String(checkInDay)) {
              await span.click();
              console.log("   ✓ Check-in selected via text match");
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log("   ⚠️ Could not select check-in date:", e.message);
    }
    await page.waitForTimeout(1000);

    const desiredCheckIn = formatDate(checkIn);
    const desiredCheckOut = formatDate(checkOut);

    const buildSearchResultsUrl = () => {
      const adults = Number(booking.adultsCount || 1);
      const url = new URL("https://www.booking.com/searchresults.html");
      url.searchParams.set("ss", String(destination));
      url.searchParams.set("checkin", desiredCheckIn);
      url.searchParams.set("checkout", desiredCheckOut);
      url.searchParams.set("group_adults", String(adults));
      url.searchParams.set("no_rooms", "1");
      url.searchParams.set("group_children", "0");
      return url.toString();
    };

    const rewriteCurrentResultsUrlWithDates = () => {
      const u = new URL(page.url());
      // Prefer explicit YYYY-MM-DD params if present/accepted
      u.searchParams.set("checkin", desiredCheckIn);
      u.searchParams.set("checkout", desiredCheckOut);

      // Also set split params when they exist (some variants rely on these)
      const [ciY, ciM, ciD] = desiredCheckIn.split("-");
      const [coY, coM, coD] = desiredCheckOut.split("-");
      if (
        u.searchParams.has("checkin_year") ||
        u.searchParams.has("checkin_month") ||
        u.searchParams.has("checkin_monthday")
      ) {
        u.searchParams.set("checkin_year", ciY);
        u.searchParams.set("checkin_month", String(parseInt(ciM, 10)));
        u.searchParams.set("checkin_monthday", String(parseInt(ciD, 10)));
      }
      if (
        u.searchParams.has("checkout_year") ||
        u.searchParams.has("checkout_month") ||
        u.searchParams.has("checkout_monthday")
      ) {
        u.searchParams.set("checkout_year", coY);
        u.searchParams.set("checkout_month", String(parseInt(coM, 10)));
        u.searchParams.set("checkout_monthday", String(parseInt(coD, 10)));
      }

      return u.toString();
    };

    // Select check-out date
    console.log(`   📅 Selecting check-out: ${formatDate(checkOut)}`);
    try {
      const dateSelector1 = `[data-date="${formatDate(checkOut)}"]`;
      const dateBtn1 = await page.$(dateSelector1);
      if (dateBtn1) {
        await dateBtn1.click();
        console.log("   ✓ Check-out selected via data-date");
      } else {
        const checkOutMonthName = checkOut.toLocaleString("en-US", {
          month: "long",
        });
        const ariaSelectorYear = `[aria-label*="${checkOutDay}"][aria-label*="${checkOutMonthName}"][aria-label*="${checkOut.getFullYear()}"]`;
        const ariaSelector = `[aria-label*="${checkOutDay}"][aria-label*="${checkOutMonthName}"]`;
        const dateBtn2 =
          (await page.$(ariaSelectorYear)) || (await page.$(ariaSelector));
        if (dateBtn2) {
          await dateBtn2.click();
          console.log("   ✓ Check-out selected via aria-label");
        } else {
          const daySpans = await page.$$(
            'span[data-date], td span, [class*="calendar"] span'
          );
          for (const span of daySpans) {
            const text = await span.textContent();
            if (text && text.trim() === String(checkOutDay)) {
              await span.click();
              console.log("   ✓ Check-out selected via text match");
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log("   ⚠️ Could not select check-out date:", e.message);
    }
    await page.waitForTimeout(1000);

    // Click Search button
    console.log("🔎 Clicking Search...");
    const searchBtn =
      'button[type="submit"], [data-testid="searchbox-search-button"]';
    await page.click(searchBtn);
    await page.waitForTimeout(5000);

    // ========== WAIT FOR RESULTS ==========
    console.log("⏳ Waiting for search results...");
    await page.waitForSelector('[data-testid="property-card"]', {
      timeout: 30000,
    });
    console.log("   ✓ Results loaded");

    // Fallback: the datepicker can land on the wrong year (e.g., Feb 2027).
    // Verify the results URL reflects the requested dates; otherwise hard-navigate with explicit params.
    try {
      const current = new URL(page.url());
      const ci = current.searchParams.get("checkin");
      const co = current.searchParams.get("checkout");
      if (!(ci === desiredCheckIn && co === desiredCheckOut)) {
        console.log(
          `   ⚠️ Results URL dates mismatch (checkin=${ci || "?"}, checkout=${
            co || "?"
          }); reloading with explicit dates...`
        );
        // First try rewriting the current results URL to keep sid/label and avoid bot-check.
        const preferredUrl = rewriteCurrentResultsUrlWithDates();
        await page.goto(preferredUrl, {
          waitUntil: "domcontentloaded",
          timeout: 90000,
        });
        await page.waitForTimeout(1500);

        // Cookie banner can re-appear on direct navigation
        try {
          const cookieBtn = await page.$(
            '#onetrust-accept-btn-handler, button:has-text("Accept")'
          );
          if (cookieBtn) {
            await cookieBtn.click();
            await page.waitForTimeout(600);
          }
        } catch (e) {}

        // Wait for results (Booking.com has multiple layouts)
        try {
          await page.waitForSelector(
            '[data-testid="property-card"], #searchresultsTmpl, [data-testid="property-card-container"]',
            { timeout: 90000 }
          );
          console.log("   ✓ Results reloaded with explicit dates");
        } catch (e) {
          const title = await page.title().catch(() => "");
          const urlNow = page.url();
          await page.screenshot({
            path: "screenshots/results_reload_failed.png",
            fullPage: true,
          });
          // If rewriting fails (rare), try the generic searchresults URL as a last resort.
          try {
            await page.goto(buildSearchResultsUrl(), {
              waitUntil: "domcontentloaded",
              timeout: 90000,
            });
            await page.waitForSelector(
              '[data-testid="property-card"], #searchresultsTmpl, [data-testid="property-card-container"]',
              { timeout: 90000 }
            );
            console.log(
              "   ✓ Results reloaded with explicit dates (fallback URL)"
            );
          } catch (e2) {
            throw new Error(
              `Results reload blocked or slow. title=${JSON.stringify(
                title
              )} url=${urlNow}. Screenshot: screenshots/results_reload_failed.png`
            );
          }
        }
      }
    } catch (e) {
      await page.goto(buildSearchResultsUrl(), {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.waitForTimeout(1500);
      try {
        const cookieBtn = await page.$(
          '#onetrust-accept-btn-handler, button:has-text("Accept")'
        );
        if (cookieBtn) {
          await cookieBtn.click();
          await page.waitForTimeout(600);
        }
      } catch (e2) {}

      await page.waitForSelector(
        '[data-testid="property-card"], #searchresultsTmpl, [data-testid="property-card-container"]',
        { timeout: 90000 }
      );
      console.log("   ✓ Results reloaded with explicit dates");
    }

    // ========== FILTER LOGIC (MUST RUN BEFORE SORTING) ==========
    console.log("🔧 Applying filters...");

    // Filter: Free cancellation
    try {
      const freeCancelFilters = [
        'text="Free cancellation"',
        '[data-filters-item*="fc=1"]',
        'input[name="nflt"][value*="fc=1"]',
        '[data-testid="filters-group-label-content"]:has-text("Free cancellation")',
      ];

      for (const selector of freeCancelFilters) {
        try {
          const filter = await page.$(selector);
          if (filter) {
            await filter.click();
            console.log("   ✓ Applied: Free cancellation filter");
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {}
      }
    } catch (e) {
      console.log('   ⚠️ Could not find "Free cancellation" filter');
    }

    // Wait for filtered results to reload
    const filterWaitMs = Number.parseInt(
      process.env.BOOKING_FILTER_WAIT_MS || "15000",
      10
    );
    console.log(
      `   ⏳ Waiting ${
        Number.isFinite(filterWaitMs) ? filterWaitMs : 15000
      }ms for filtered results to load...`
    );
    await page.waitForTimeout(
      Number.isFinite(filterWaitMs) ? filterWaitMs : 15000
    );
    await page.waitForLoadState("networkidle");

    // ========== SORT & FILTER (URL Parameter Injection) ==========
    // 🔥🔥 NEW: Applied requested filters (Cheapest + Free Cancel + No Prepayment) 🔥🔥
    console.log("💰 Sorting by Price + Applying 'No Prepayment' Filter...");
    try {
      // Get current URL (which now includes filter parameters)
      const currentUrl = page.url();
      console.log("   📍 Current URL captured");

      // Parse URL
      const url = new URL(currentUrl);

      // 1. Force Sort: Lowest Price
      url.searchParams.set("sort_by", "price_starting_from_lowest");
      url.searchParams.set("order", "price");

      // 2. Force Filters: Free Cancellation + No Prepayment
      // fc=1  -> Free Cancellation
      // cancellation_type=no_prepayment -> No Prepayment Needed (Pay at property)
      const existingNflt = url.searchParams.get("nflt") || "";
      const newFilters = "fc=1;cancellation_type=no_prepayment;";
      url.searchParams.set("nflt", existingNflt + newFilters);

      // CRITICAL: Force USD currency to avoid local currency confusion
      url.searchParams.set("selected_currency", "USD");

      const sortedUrl = url.toString();
      console.log(
        "   🔗 Navigating to Filtered URL (Cheapest, Free Cancel, No Prepay)..."
      );
      console.log("   💵 Currency forced to USD");

      // Navigate to the sorted URL
      await page.goto(sortedUrl, { waitUntil: "networkidle", timeout: 60000 });

      // Wait for results to reload with new sorting
      await page.waitForSelector('[data-testid="property-card"]', {
        timeout: 30000,
      });
      console.log("   ✓ Filters applied successfully via URL injection");
    } catch (e) {
      console.log("   ⚠️ URL parameter sorting failed, using fallback");
      console.log("   Error:", e.message);
    }

    // ========== TARGETED BUDGET SELECTION LOGIC ==========
    console.log("🏨 Selecting hotel with targeted budget logic...");
    console.log(
      `   💰 Budget Range: $${booking.minPrice} - $${booking.maxPrice} per night`
    );

    const hotelCards = await page.$$('[data-testid="property-card"]');
    console.log(`   Found ${hotelCards.length} hotels`);

    let candidates = [];

    // Build list of candidate cards within budget (per-night)
    for (let i = 0; i < hotelCards.length; i++) {
      const card = hotelCards[i];
      let cardPrice = 0;
      let pricePerNight = 0;
      try {
        const priceElement = await card.$(
          '[data-testid="price-and-discounted-price"]'
        );
        if (priceElement) {
          const priceText = await priceElement.textContent();
          const numeric = priceText.replace(/[^0-9.,]/g, "");
          const match = numeric.match(/[0-9]+(?:[.,][0-9]+)*/);
          if (match) {
            cardPrice = parseFloat(match[0].replace(/,/g, ""));
            pricePerNight = Math.round(cardPrice / nights);
          }
        }
      } catch (e) {}

      console.log(
        `   Hotel ${
          i + 1
        }: Total = $${cardPrice}, Per Night = $${pricePerNight}`
      );

      if (pricePerNight < booking.minPrice) {
        console.log(`      ⏭️  Skip (below minimum quality threshold)`);
        continue;
      }
      if (pricePerNight > booking.maxPrice) {
        console.log(`      ⏭️  Skip (too expensive, checking next options...)`);
        continue;
      }

      // Extract hotel name/address for logging
      let hName = "Unknown Hotel";
      let hAddress = "";
      try {
        const nameElement = await card.$(
          '[data-testid="title"], h3, .sr-hotel__name'
        );
        if (nameElement)
          hName = (await nameElement.textContent())?.trim() || hName;
      } catch (e) {}
      try {
        const addressElement = await card.$(
          '[data-testid="address"], .sr_card_address_line'
        );
        if (addressElement)
          hAddress = (await addressElement.textContent())?.trim() || "";
      } catch (e) {}

      candidates.push({
        card,
        index: i,
        price: pricePerNight,
        hotelName: hName,
        address: hAddress,
      });
    }

    if (candidates.length === 0) {
      throw new Error(
        `No hotels found within budget range $${booking.minPrice} - $${booking.maxPrice} per night. All ${hotelCards.length} hotels were either too cheap or too expensive.`
      );
    }

    console.log(`   ✓ ${candidates.length} candidate(s) found within budget`);

    // Helper to detect online/prepayment-required indicators
    const detectsOnlinePayment = (text) => {
      if (!text) return false;
      const t = text.toLowerCase();

      const badSignals = [
        "requires prepayment",
        "payment before arrival",
        "full payment is required",
        "non-refundable",
        "pay the full amount",
        "Pay now",
        "charged immediately",
        "prepayment of the total price at any time",
        "charged a prepayment of the total price at any time",
        "you'll be charged a prepayment",
      ];
      const safeSignals = [
        "no prepayment needed",
        "pay at the property",
        "pay at the hotel",
        "no credit card needed",
        "manage your booking online",
      ];

      if (safeSignals.some((s) => t.includes(s))) {
        return false;
      }

      return badSignals.some((s) => t.includes(s));
    };

    let selectedCard = null;
    let hotelName = "Unknown Hotel";
    let price = 0;
    let address = "";
    let newPage = null; // details page for the selected hotel

    // Try candidates one by one until we find one that does NOT require online payment
    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      console.log(
        `   🔁 Trying candidate ${ci + 1}/${candidates.length}: ${
          cand.hotelName
        } ($${cand.price}/night)`
      );

      // Click hotel title to open details (new tab)
      const titleLink = await cand.card.$('[data-testid="title"]');
      if (!titleLink) {
        console.log(
          "   ⚠️ Hotel title link not found for candidate, skipping..."
        );
        continue;
      }

      // use outer-scoped newPage variable
      try {
        const href = await titleLink.getAttribute("href");
        if (href) {
          const fullUrl = href.startsWith("http")
            ? href
            : `https://www.booking.com${href}`;
          newPage = await context.newPage();
          await newPage.goto(fullUrl, { waitUntil: "domcontentloaded" });
        } else {
          [newPage] = await Promise.all([
            context.waitForEvent("page"),
            titleLink.click(),
          ]);
          await newPage.waitForLoadState("domcontentloaded");
        }
      } catch (e) {
        console.log("   ⚠️ Open details failed, trying click fallback...");
        try {
          [newPage] = await Promise.all([
            context.waitForEvent("page"),
            titleLink.click(),
          ]);
          await newPage.waitForLoadState("domcontentloaded");
        } catch (e2) {
          console.log("   ⚠️ Could not open hotel details, skipping candidate");
          continue;
        }
      }

      console.log("   ✓ Switched to hotel details tab");

      // Wait a bit and inspect page to look for payment indicators without proceeding
      await newPage.waitForTimeout(2000).catch(() => {});
      const pageText = await newPage
        .evaluate(() => document.body.innerText)
        .catch(() => "");
      const lowerPageText = (pageText || "").toLowerCase();

      if (detectsOnlinePayment(lowerPageText)) {
        console.log(
          "   ⚠️ Detected online/prepayment required for this option — closing tab and trying next candidate"
        );
        await newPage.close().catch(() => {});
        continue; // try next candidate
      }

      // If we reach here, this candidate does not indicate online payment — select it
      selectedCard = cand.card;
      hotelName = cand.hotelName;
      price = cand.price;
      address = cand.address;

      // Keep the current details page for further booking steps (newPage already set)
      break;
    }

    if (!selectedCard) {
      throw new Error(
        "All candidate hotels require online/prepayment; none are payable at property. Aborting booking attempt."
      );
    }

    console.log(`   ✓ Selected: ${hotelName}`);
    console.log(`   💰 Price: ${price}`);
    console.log(`   📍 Address: ${address}`);

    // Select beds based on number of adults
    try {
      const adultsCount = booking.adultsCount || 2;
      console.log(`   🛏️ Selecting room for ${adultsCount} adult(s)...`);

      // Look for room selection based on occupancy
      const roomSelectors = [
        `button:has-text("${adultsCount} adult")`,
        `[data-title*="${adultsCount} adult"]`,
        'button:has-text("Select")',
        '[data-testid="select-room-trigger"]',
      ];

      for (const selector of roomSelectors) {
        try {
          const selectBtn = await newPage.$(selector);
          if (selectBtn) {
            await selectBtn.click();
            console.log(`   ✓ Selected room for ${adultsCount} adult(s)`);
            await newPage.waitForTimeout(2000);
            break;
          }
        } catch (e) {}
      }
    } catch (e) {
      console.log("   ⚠️ Could not auto-select beds, proceeding...");
    }

    // Refresh details from hotel page to be certain
    try {
      const detailNameEl = await newPage.$('h2, [data-testid="hotel-name"]');
      if (detailNameEl) {
        const detailName = await detailNameEl.textContent();
        if (detailName) hotelName = detailName.trim();
      }
    } catch (e) {}

    try {
      const detailAddressEl = await newPage.$(
        '[data-testid="address"], [data-node_tt_view*="address"], [class*="address"]'
      );
      if (detailAddressEl) {
        const detailAddress = await detailAddressEl.textContent();
        if (detailAddress) address = detailAddress.trim();
      }
    } catch (e) {}

    // ========== REAL BOOKING MODE ==========
    console.log("💳 REAL BOOKING MODE: Proceeding with actual reservation");
    console.log("   ⚠️ This WILL create a real booking and charge the card");

    // Initialize booking data object to store results
    const bookingData = {
      pnr: null,
      hotelName: hotelName,
      price: price,
      hotelAddress: address,
      freeCancellationDeadline: null,
    };

    try {
      // Make sure a room is selected first
      console.log("   🛏️ Ensuring room is selected...");

      // Look for room selection dropdown and select 1 room if not selected
      const roomDropdown = await newPage.$('select[name*="nr_rooms"]');
      if (roomDropdown) {
        const currentValue = await roomDropdown.evaluate((el) => el.value);
        if (!currentValue || currentValue === "0") {
          await roomDropdown.selectOption("1");
          console.log("   ✓ Selected 1 room from dropdown");
          await newPage.waitForTimeout(1000);
        }
      }

      // Look for "I'll reserve" button specifically (not generic submit buttons)
      console.log("   🔍 Looking for reservation button...");

      const reserveSelectors = [
        'button:has-text("I\'ll reserve")',
        'a:has-text("I\'ll reserve")',
        '[data-testid="recommended-booking-option-cta"]',
        'button:has-text("Reserve")',
        'a.btn:has-text("Reserve")',
        'button:has-text("Book now")',
      ];

      let reserveBtn = null;
      let reserveSelector = null;
      for (const selector of reserveSelectors) {
        try {
          reserveBtn = await newPage.$(selector);
          if (reserveBtn && (await reserveBtn.isVisible())) {
            reserveSelector = selector;
            const btnText = await reserveBtn.textContent();
            console.log(`   ✓ Found reserve button: "${btnText.trim()}"`);
            break;
          }
        } catch (e) {}
      }

      if (reserveBtn) {
        // Click and wait for navigation
        await Promise.all([
          newPage
            .waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 10000,
            })
            .catch(() => {}),
          reserveBtn.click(),
        ]);
        console.log("   ✓ Clicked reserve/book button");
        await newPage.waitForTimeout(3000);

        // Take screenshot after clicking reserve
        const afterReservePath = path.join(
          __dirname,
          "../../screenshots/after_reserve_click.png"
        );
        await newPage.screenshot({ path: afterReservePath });
        console.log("   📸 Screenshot after reserve click saved");

        // Wait for page to settle and check what page we're on
        await newPage.waitForTimeout(3000);

        // Check if we're on "Enter Your Details" page
        console.log("   🔍 Checking for details form...");

        // Get page content for debugging
        const pageText = await newPage.evaluate(() => document.body.innerText);
        const pageTitle = await newPage.title();
        const pageUrl = newPage.url();
        console.log(`   📄 Page title: ${pageTitle}`);
        console.log(`   🔗 Page URL: ${pageUrl}`);

        // Check if URL contains booking/confirmation paths
        const isBookingFormUrl =
          pageUrl.includes("/book") ||
          pageUrl.includes("/checkout") ||
          pageUrl.includes("/reservation");

        // Check for STRONG details page indicators
        const detailsPageIndicators = [
          "enter your details",
          "almost done",
          "who are you booking for",
          "good to know",
          "your booking details",
        ];

        let onDetailsPage = false;
        const lowerPageText = pageText.toLowerCase();

        // Must find indicator AND not be on hotel details page
        for (const indicator of detailsPageIndicators) {
          if (lowerPageText.includes(indicator)) {
            // Extra check: make sure we're not on hotel details (has search box)
            if (!lowerPageText.includes("where are you going")) {
              onDetailsPage = true;
              console.log(
                `   ✓ Details page detected (found text: "${indicator}")`
              );
              break;
            }
          }
        }

        // Also check if URL changed to booking page
        if (!onDetailsPage && isBookingFormUrl) {
          onDetailsPage = true;
          console.log(
            "   ✓ Details page detected (URL contains /book or /checkout)"
          );
        }

        // Don't check input fields if still on hotel page (has search box)
        if (!onDetailsPage && !lowerPageText.includes("where are you going")) {
          const inputFields = await newPage.$$(
            'input[type="text"], input[type="email"], input[type="tel"]'
          );
          if (inputFields.length > 2 && inputFields.length < 20) {
            onDetailsPage = true;
            console.log(
              `   ✓ Details page detected (found ${inputFields.length} input fields)`
            );
          }
        }

        if (onDetailsPage) {
          console.log("   📝 Filling booking details form...");

          // ========== EXTRACT FREE CANCELLATION DEADLINE ==========
          console.log("   🔍 Extracting free cancellation deadline...");
          try {
            const cancellationInfo = await newPage.evaluate(() => {
              const bodyText = document.body.innerText;

              // Look for patterns like "from January 2, 2026 1:53 AM: € 43.20" or similar
              // This indicates when cancellation fees start
              const patterns = [
                // Pattern: "from [date]: [price]" - the date is when fees start
                /from\s+(\w+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)\s*[:\-–]?\s*[€$£]/i,
                // Pattern: "Cancellation cost from [date]"
                /cancellation\s+cost\s*(?:from\s+)?(\w+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
                // Pattern: "Free cancellation until [date]" or "before [date]"
                /free\s+cancellation\s+(?:until|before)\s+(\w+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
                // Pattern: "Cancel for free until [date]"
                /cancel\s+(?:for\s+)?free\s+(?:until|before)\s+(\w+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
                // Pattern: numeric date format dd/mm/yyyy or mm/dd/yyyy
                /from\s+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}(?:\s+\d{1,2}:\d{2})?)\s*[:\-–]?\s*[€$£]/i,
                // Alternative: "Free cancellation before [date]"
                /free\s+cancellation\s+before\s+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})/i,
              ];

              for (const pattern of patterns) {
                const match = bodyText.match(pattern);
                if (match && match[1]) {
                  return match[1].trim();
                }
              }

              // Also look in specific elements
              const cancellationElements = document.querySelectorAll(
                '[data-testid*="cancellation"], [class*="cancellation"], [class*="cancel"]'
              );
              for (const el of cancellationElements) {
                const text = el.innerText || el.textContent || "";
                for (const pattern of patterns) {
                  const match = text.match(pattern);
                  if (match && match[1]) {
                    return match[1].trim();
                  }
                }
              }

              return null;
            });

            if (cancellationInfo) {
              console.log(
                `   📅 Found cancellation deadline text: ${cancellationInfo}`
              );

              // Parse the date string
              try {
                const parsedDate = new Date(cancellationInfo);
                if (!isNaN(parsedDate.getTime())) {
                  bookingData.freeCancellationDeadline = parsedDate;
                  console.log(
                    `   ✓ Free cancellation deadline: ${parsedDate.toLocaleString()}`
                  );
                } else {
                  // Try manual parsing for different formats
                  // Format: "January 2, 2026 1:53 AM"
                  const dateMatch = cancellationInfo.match(
                    /(\w+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i
                  );
                  if (dateMatch) {
                    const months = {
                      january: 0,
                      february: 1,
                      march: 2,
                      april: 3,
                      may: 4,
                      june: 5,
                      july: 6,
                      august: 7,
                      september: 8,
                      october: 9,
                      november: 10,
                      december: 11,
                    };
                    const month = months[dateMatch[1].toLowerCase()];
                    const day = parseInt(dateMatch[2]);
                    const year = parseInt(dateMatch[3]);
                    let hours = dateMatch[4] ? parseInt(dateMatch[4]) : 0;
                    const minutes = dateMatch[5] ? parseInt(dateMatch[5]) : 0;
                    const ampm = dateMatch[6];

                    if (ampm && ampm.toUpperCase() === "PM" && hours < 12)
                      hours += 12;
                    if (ampm && ampm.toUpperCase() === "AM" && hours === 12)
                      hours = 0;

                    if (month !== undefined) {
                      const parsedManual = new Date(
                        year,
                        month,
                        day,
                        hours,
                        minutes
                      );
                      if (!isNaN(parsedManual.getTime())) {
                        bookingData.freeCancellationDeadline = parsedManual;
                        console.log(
                          `   ✓ Free cancellation deadline: ${parsedManual.toLocaleString()}`
                        );
                      }
                    }
                  }
                }
              } catch (parseErr) {
                console.log(
                  `   ⚠️ Could not parse cancellation date: ${parseErr.message}`
                );
              }
            } else {
              console.log("   ℹ️ No cancellation deadline found on page");
            }
          } catch (e) {
            console.log(
              `   ⚠️ Error extracting cancellation deadline: ${e.message}`
            );
          }

          const normalizeCountryCode = (raw) => {
            if (!raw) return null;
            const s = String(raw).trim();
            if (s.length === 2) return s.toUpperCase();
            const k = s.toLowerCase();
            const map = {
              turkey: "TR",
              turkiye: "TR",
              türkiye: "TR",
              egypt: "EG",
              tunisia: "TN",
              france: "FR",
              germany: "DE",
              algeria: "DZ",
              morocco: "MA",
              saudi: "SA",
              "saudi arabia": "SA",
              uae: "AE",
              "united arab emirates": "AE",
            };
            return map[k] || null;
          };

          const inferCountryCodeFromDestination = (destination) => {
            const d = String(destination || "")
              .trim()
              .toLowerCase();
            if (!d) return null;
            const map = {
              paris: "FR",
              istanbul: "TR",
              tunis: "TN",
              "tunis city": "TN",
              cairo: "EG",
              "new york": "US",
              london: "GB",
            };
            return map[d] || null;
          };

          const inferCountryCodeFromPhone = (phone) => {
            const phoneStr = String(phone || "").trim();
            let digits = phoneStr.replace(/\D/g, "");
            // Convert international prefix 00xxxx -> xxxx
            if (digits.startsWith("00")) digits = digits.slice(2);
            if (digits.startsWith("20")) return "EG";
            if (digits.startsWith("216")) return "TN";
            if (digits.startsWith("90")) return "TR";
            if (digits.startsWith("33")) return "FR";
            if (digits.startsWith("49")) return "DE";
            return null;
          };

          // DEBUG: List all input fields on the page
          const allInputs = await newPage.evaluate(() => {
            const inputs = Array.from(
              document.querySelectorAll("input, select")
            );
            return inputs.map((input) => ({
              tag: input.tagName,
              type: input.type,
              name: input.name,
              id: input.id,
              placeholder: input.placeholder,
              autocomplete: input.autocomplete,
              visible: input.offsetParent !== null,
            }));
          });
          console.log(
            `   🔍 Found ${allInputs.length} total input/select fields:`
          );
          allInputs.forEach((inp, idx) => {
            if (inp.visible) {
              console.log(
                `      ${idx + 1}. ${inp.tag} type="${inp.type}" name="${
                  inp.name
                }" id="${inp.id}" placeholder="${inp.placeholder}"`
              );
            }
          });

          // Fill first name and last name
          const nameParts = booking.clientName.split(" ");
          const firstName = nameParts[0] || booking.clientName;
          const lastName = nameParts.slice(1).join(" ") || firstName;

          // First name - try multiple selectors INCLUDING case-insensitive
          const firstNameSelectors = [
            'input[name="firstname"]',
            'input[name="firstName"]',
            'input[name="first_name"]',
            'input[id*="firstname" i]',
            'input[id*="firstName" i]',
            'input[id*="first" i]',
            'input[placeholder*="First" i]',
            'input[placeholder*="first" i]',
            'input[autocomplete="given-name"]',
            'input[type="text"]:visible', // Fallback to first visible text input
          ];

          let firstNameFilled = false;
          for (const selector of firstNameSelectors) {
            try {
              const field = await newPage.$(selector);
              if (field && (await field.isVisible())) {
                await field.fill(firstName);
                console.log(
                  `   ✓ Filled first name: ${firstName} (selector: ${selector})`
                );
                firstNameFilled = true;
                break;
              }
            } catch (e) {}
          }

          if (!firstNameFilled) {
            console.log(
              "   ⚠️ Could not find first name field - trying first visible text input"
            );
            try {
              const firstInput = await newPage.$('input[type="text"]:visible');
              if (firstInput) {
                await firstInput.fill(firstName);
                console.log(
                  `   ✓ Filled first visible input with first name: ${firstName}`
                );
                firstNameFilled = true;
              }
            } catch (e) {}
          }

          // Last name - try multiple selectors
          const lastNameSelectors = [
            'input[name="lastname"]',
            'input[name="lastName"]',
            'input[name="last_name"]',
            'input[id*="lastname" i]',
            'input[id*="lastName" i]',
            'input[id*="last" i]',
            'input[placeholder*="Last" i]',
            'input[placeholder*="last" i]',
            'input[autocomplete="family-name"]',
          ];

          let lastNameFilled = false;
          for (const selector of lastNameSelectors) {
            try {
              const field = await newPage.$(selector);
              if (field && (await field.isVisible())) {
                await field.fill(lastName);
                console.log(
                  `   ✓ Filled last name: ${lastName} (selector: ${selector})`
                );
                lastNameFilled = true;
                break;
              }
            } catch (e) {}
          }

          if (!lastNameFilled) {
            console.log(
              "   ⚠️ Could not find last name field - trying second visible text input"
            );
            try {
              const textInputs = await newPage.$$('input[type="text"]:visible');
              if (textInputs.length > 1) {
                await textInputs[1].fill(lastName);
                console.log(
                  `   ✓ Filled second visible input with last name: ${lastName}`
                );
                lastNameFilled = true;
              }
            } catch (e) {}
          }

          // Email
          const emailSelectors = [
            'input[name="email"]',
            'input[type="email"]',
            'input[id*="email" i]',
            'input[placeholder*="email" i]',
            'input[autocomplete="email"]',
          ];

          let emailFilled = false;
          for (const selector of emailSelectors) {
            try {
              const field = await newPage.$(selector);
              if (field && (await field.isVisible())) {
                await field.fill(booking.email);
                console.log(
                  `   ✓ Filled email: ${booking.email} (selector: ${selector})`
                );
                emailFilled = true;
                break;
              }
            } catch (e) {}
          }

          if (!emailFilled) {
            console.log("   ⚠️ Could not find email field - trying type=email");
            try {
              const emailInput = await newPage.$('input[type="email"]:visible');
              if (emailInput) {
                await emailInput.fill(booking.email);
                console.log(`   ✓ Filled email field: ${booking.email}`);
                emailFilled = true;
              }
            } catch (e) {}
          }

          // Country/Region
          {
            const preferredCountryCode =
              normalizeCountryCode(booking.country) ||
              inferCountryCodeFromPhone(booking.phone) ||
              inferCountryCodeFromDestination(booking.destination);

            if (preferredCountryCode) {
              const countrySelectors = [
                'select[name="countryCode"]',
                "#countryCode",
                'select[name*="country"]',
                'select[id*="country"]',
                '[data-testid="country-select"]',
              ];

              let countryFilled = false;
              for (const selector of countrySelectors) {
                try {
                  const field = await newPage.$(selector);
                  if (field) {
                    // Wait for options to be present (Booking.com sometimes hydrates selects late)
                    await newPage
                      .waitForFunction(
                        (sel) => {
                          const el = document.querySelector(sel);
                          return (
                            !!el &&
                            (el.querySelectorAll("option")?.length || 0) > 5
                          );
                        },
                        { timeout: 5000 },
                        selector
                      )
                      .catch(() => {});

                    try {
                      // Option values are often lowercase (e.g. "eg"); match case-insensitively.
                      const desired = String(preferredCountryCode).trim();
                      const optionValue = await newPage.evaluate(
                        ({ sel, desired }) => {
                          const el = document.querySelector(sel);
                          if (!el) return null;
                          const opts = Array.from(
                            el.querySelectorAll("option")
                          );
                          const exact = opts.find(
                            (o) => String(o.value).trim() === desired
                          );
                          if (exact) return exact.value;
                          const ci = opts.find(
                            (o) =>
                              String(o.value).trim().toLowerCase() ===
                              desired.toLowerCase()
                          );
                          return ci ? ci.value : null;
                        },
                        { sel: selector, desired }
                      );

                      if (optionValue) {
                        await newPage.selectOption(selector, {
                          value: optionValue,
                        });
                        console.log(
                          `   ✓ Selected country code: ${preferredCountryCode} (value=${optionValue})`
                        );
                        countryFilled = true;
                        break;
                      }
                    } catch (e) {
                      // If value selection fails, try label selection (useful if booking.country is a full name)
                      const raw = String(booking.country || "").trim();
                      if (raw) {
                        try {
                          await newPage.selectOption(selector, { label: raw });
                          console.log(`   ✓ Selected country: ${raw}`);
                          countryFilled = true;
                          break;
                        } catch (e2) {}
                      }
                    }
                  }
                } catch (e) {}
              }

              if (!countryFilled) {
                console.log(
                  `   ⚠️ Could not find/fill country field (wanted ${preferredCountryCode})`
                );
              }
            }
          }

          // Phone
          if (booking.phone) {
            // Try to select calling code dropdown (Booking uses `cc1`).
            // Prefer matching the phone's actual prefix (e.g. +20), else fall back to Tunisia (+216).
            try {
              const ccSelector = 'select[name="cc1"]';
              const callingCodeSelect = await newPage.$(ccSelector);
              if (callingCodeSelect && (await callingCodeSelect.isVisible())) {
                await newPage
                  .waitForFunction(
                    (sel) => {
                      const el = document.querySelector(sel);
                      return (
                        !!el && (el.querySelectorAll("option")?.length || 0) > 5
                      );
                    },
                    { timeout: 5000 },
                    ccSelector
                  )
                  .catch(() => {});

                // Booking.com's cc1 values are typically ISO2 country codes (e.g. "eg"), not numeric dial codes.
                // First try selecting by country ISO2 (derived from booking.country/phone), then fall back to dial-code text matching.
                const preferredCountryCode =
                  normalizeCountryCode(booking.country) ||
                  inferCountryCodeFromPhone(booking.phone) ||
                  inferCountryCodeFromDestination(booking.destination);

                const phoneStr = String(booking.phone).trim();
                // Extract all digits (handles spaces, dashes, parentheses)
                let digits = phoneStr.replace(/\D/g, "");
                if (digits.startsWith("00")) digits = digits.slice(2);

                const dialCandidates = [];
                if (digits) {
                  dialCandidates.push(digits.slice(0, 3));
                  dialCandidates.push(digits.slice(0, 2));
                  dialCandidates.push(digits.slice(0, 1));
                }
                dialCandidates.push("216");

                const options = await newPage.evaluate((sel) => {
                  const el = document.querySelector(sel);
                  if (!el) return [];
                  return Array.from(el.querySelectorAll("option")).map((o) => ({
                    value: o.value,
                    text: (o.textContent || "").trim(),
                  }));
                }, ccSelector);

                let ccSet = false;
                if (preferredCountryCode) {
                  const desired = String(preferredCountryCode).toLowerCase();
                  const byIso = options.find(
                    (o) =>
                      String(o.value || "")
                        .trim()
                        .toLowerCase() === desired
                  );
                  if (byIso?.value) {
                    await newPage.selectOption(ccSelector, {
                      value: byIso.value,
                    });
                    console.log(
                      `   ✓ Selected calling code country: ${String(
                        byIso.text || ""
                      ).trim()}`
                    );
                    ccSet = true;
                  }
                }

                if (!ccSet) {
                  const match = options.find((o) =>
                    dialCandidates.some((code) => {
                      if (!code) return false;
                      const t = (o.text || "").toLowerCase();
                      return (
                        t.includes(`+${code}`) ||
                        t.startsWith(`+${code}`) ||
                        String(o.value) === String(code)
                      );
                    })
                  );

                  if (match?.value) {
                    await newPage
                      .selectOption(ccSelector, { value: match.value })
                      .catch(async () => {
                        // Some variants only work via label
                        await newPage.selectOption(ccSelector, {
                          label: match.text,
                        });
                      });
                    console.log(
                      `   ✓ Selected calling code: ${String(
                        match.text || ""
                      ).trim()}`
                    );
                    ccSet = true;
                  }
                }

                if (!ccSet) {
                  console.log("   ℹ️ Could not set calling code dropdown");
                  const sample = options
                    .slice(0, 8)
                    .map((o) => `${o.text} [${o.value}]`)
                    .join(" | ");
                  if (sample) {
                    console.log(`      cc1 options sample: ${sample}`);
                  }
                }
              }
            } catch (e) {
              console.log("   ℹ️ Could not set calling code dropdown");
            }

            const phoneSelectors = [
              'input[name="phoneNumber"][required]',
              'input[name="phoneNumber"][aria-required="true"]',
              'input[name="phoneNumber"]', // Booking.com uses camelCase
              'input[name="phone"]',
              'input[name="phone_number"]',
              'input[type="tel"][required]',
              'input[type="tel"]',
              'input[id*="phone" i]',
              'input[placeholder*="phone" i]',
              'input[autocomplete="tel"]',
            ];

            const toLocalPhoneDigits = (rawPhone, iso2) => {
              const raw = String(rawPhone || "").trim();
              // Extract all digits (handles spaces, dashes, parentheses)
              let digits = raw.replace(/\D/g, "");
              if (digits.startsWith("00")) digits = digits.slice(2);
              const dialByIso = {
                EG: "20",
                TN: "216",
                TR: "90",
                FR: "33",
                DE: "49",
              };
              const dial = dialByIso[String(iso2 || "").toUpperCase()] || null;
              if (dial && digits.startsWith(dial)) {
                return digits.slice(dial.length);
              }
              // If user already provided a local number, keep as-is
              return digits;
            };

            const preferredCountryCodeForPhone =
              normalizeCountryCode(booking.country) ||
              inferCountryCodeFromPhone(booking.phone);
            const phoneToFill = toLocalPhoneDigits(
              booking.phone,
              preferredCountryCodeForPhone
            );

            let phoneFilled = false;
            for (const selector of phoneSelectors) {
              try {
                const field = await newPage.$(selector);
                if (field && (await field.isVisible())) {
                  // Booking validates this field strictly; use click+type and prefer local digits (cc1 already selected).
                  await field.click({ clickCount: 3 }).catch(() => {});
                  await field.fill("").catch(() => {});
                  await field
                    .type(phoneToFill, { delay: 35 })
                    .catch(async () => {
                      await field.fill(phoneToFill);
                    });

                  const actual = await field
                    .evaluate((el) => String(el.value || "").trim())
                    .catch(() => "");
                  if (!actual) {
                    continue;
                  }
                  console.log(
                    `   ✓ Filled phone: ${actual} (selector: ${selector})`
                  );
                  phoneFilled = true;
                  break;
                }
              } catch (e) {}
            }

            if (!phoneFilled) {
              console.log("   ⚠️ Could not find phone field - trying type=tel");
              try {
                const phoneInput = await newPage.$('input[type="tel"]:visible');
                if (phoneInput) {
                  await phoneInput.click({ clickCount: 3 }).catch(() => {});
                  await phoneInput.fill("").catch(() => {});
                  await phoneInput
                    .type(phoneToFill, { delay: 35 })
                    .catch(async () => {
                      await phoneInput.fill(phoneToFill);
                    });
                  const actual = await phoneInput
                    .evaluate((el) => String(el.value || "").trim())
                    .catch(() => "");
                  if (actual) {
                    console.log(`   ✓ Filled phone field: ${actual}`);
                    phoneFilled = true;
                  }
                }
              } catch (e) {}
            }
          }

          const tryFillDob = async () => {
            if (!booking.passengerDOB) return false;

            const dob = new Date(booking.passengerDOB);
            const yyyy = String(dob.getFullYear());
            const mm = String(dob.getMonth() + 1).padStart(2, "0");
            const dd = String(dob.getDate()).padStart(2, "0");
            const iso = `${yyyy}-${mm}-${dd}`;

            const dobInputSelectors = [
              'input[type="date"][name*="birth" i]',
              'input[type="date"][name*="dob" i]',
              'input[type="date"][aria-label*="date of birth" i]',
              'input[type="date"][placeholder*="date of birth" i]',
              'input[name*="birth" i]',
              'input[name*="dob" i]',
              'input[id*="birth" i]',
              'input[id*="dob" i]',
              'input[aria-label*="date of birth" i]',
              'input[placeholder*="date of birth" i]',
              'input[placeholder*="birth" i]',
              'input[placeholder*="MM/DD/YYYY" i]',
              'input[placeholder*="DD/MM/YYYY" i]',
            ];

            for (const sel of dobInputSelectors) {
              const el = await newPage.$(sel);
              if (el && (await el.isVisible())) {
                await el.scrollIntoViewIfNeeded().catch(() => {});
                await el.click({ clickCount: 3 }).catch(() => {});
                await el.fill("").catch(() => {});

                const inputType = await el
                  .evaluate((n) => String(n.type || "").toLowerCase())
                  .catch(() => "");

                const placeholder = await el
                  .evaluate((n) => String(n.getAttribute("placeholder") || ""))
                  .catch(() => "");

                const preferMDY = /MM\s*\/\s*DD\s*\/\s*YYYY/i.test(placeholder);

                const candidates =
                  inputType === "date"
                    ? [iso]
                    : preferMDY
                    ? [
                        `${mm}/${dd}/${yyyy}`,
                        `${dd}/${mm}/${yyyy}`,
                        `${dd}-${mm}-${yyyy}`,
                        iso,
                      ]
                    : [
                        `${dd}/${mm}/${yyyy}`,
                        `${dd}-${mm}-${yyyy}`,
                        `${mm}/${dd}/${yyyy}`,
                        iso,
                      ];

                let ok = false;
                for (const value of candidates) {
                  await el.click({ clickCount: 3 }).catch(() => {});
                  await el.fill("").catch(() => {});

                  if (inputType === "date") {
                    // Some browsers/pages ignore typing into date inputs; set value + dispatch events.
                    await el
                      .evaluate((n, v) => {
                        n.value = v;
                        n.dispatchEvent(new Event("input", { bubbles: true }));
                        n.dispatchEvent(new Event("change", { bubbles: true }));
                      }, value)
                      .catch(() => {});
                    await el.fill(value).catch(() => {});
                  } else {
                    await el.type(value, { delay: 25 }).catch(async () => {
                      await el.fill(value);
                    });
                  }

                  const actual = await el
                    .evaluate((n) => String(n.value || "").trim())
                    .catch(() => "");

                  if (inputType === "date") {
                    if (actual === iso) {
                      console.log(`   ✓ Filled date of birth: ${actual}`);
                      ok = true;
                      break;
                    }
                  } else {
                    const yearMatch = actual.match(/(\d{4})/);
                    if (yearMatch && yearMatch[1] === yyyy) {
                      console.log(`   ✓ Filled date of birth: ${actual}`);
                      ok = true;
                      break;
                    }
                  }
                }

                if (ok) return true;
              }
            }

            // Label-based lookup (Booking.com often uses a generic placeholder like MM/DD/YYYY)
            try {
              const handle = await newPage.evaluateHandle(() => {
                const labels = Array.from(document.querySelectorAll("label"));
                const label = labels.find((l) =>
                  /date\s*of\s*birth/i.test((l.textContent || "").trim())
                );
                if (!label) return null;
                const forId = label.getAttribute("for");
                if (forId) return document.getElementById(forId);
                return (
                  label.querySelector("input") ||
                  label.closest("div")?.querySelector("input") ||
                  null
                );
              });

              const el = handle.asElement();
              if (el) {
                await el.scrollIntoViewIfNeeded().catch(() => {});
                await el.click({ clickCount: 3 }).catch(() => {});
                await el.fill("").catch(() => {});
                // For text-based DOB fields Booking uses MM/DD/YYYY
                await el
                  .type(`${mm}/${dd}/${yyyy}`, { delay: 25 })
                  .catch(async () => {
                    await el.fill(`${mm}/${dd}/${yyyy}`);
                  });
                const actual = await el
                  .evaluate((n) => String(n.value || "").trim())
                  .catch(() => "");
                if (actual) {
                  const yearMatch = actual.match(/(\d{4})/);
                  if (yearMatch && yearMatch[1] === yyyy) {
                    console.log(`   ✓ Filled date of birth: ${actual}`);
                    return true;
                  }
                }
              }
            } catch (e) {}

            // Split selects (day/month/year)
            const pickFirstVisible = async (sels) => {
              for (const s of sels) {
                const h = await newPage.$(s);
                if (h && (await h.isVisible())) return s;
              }
              return null;
            };

            const daySel = await pickFirstVisible([
              'select[name*="birth_day" i]',
              'select[name*="dob_day" i]',
              'select[name*="birthdate_day" i]',
            ]);
            const monthSel = await pickFirstVisible([
              'select[name*="birth_month" i]',
              'select[name*="dob_month" i]',
              'select[name*="birthdate_month" i]',
            ]);
            const yearSel = await pickFirstVisible([
              'select[name*="birth_year" i]',
              'select[name*="dob_year" i]',
              'select[name*="birthdate_year" i]',
            ]);

            if (daySel && monthSel && yearSel) {
              await newPage
                .selectOption(daySel, { value: String(parseInt(dd, 10)) })
                .catch(async () => {
                  await newPage.selectOption(daySel, { value: dd });
                });
              await newPage
                .selectOption(monthSel, { value: String(parseInt(mm, 10)) })
                .catch(async () => {
                  await newPage.selectOption(monthSel, { value: mm });
                });
              await newPage.selectOption(yearSel, { value: yyyy });
              console.log(`   ✓ Selected date of birth: ${dd}/${mm}/${yyyy}`);
              return true;
            }

            return false;
          };

          // Date of Birth (sometimes required on Booking.com secure checkout)
          try {
            const dobRequiredField = await newPage.$(
              'input:visible[required][name*="birth" i], input:visible[required][name*="dob" i], select:visible[required][name*="birth" i], select:visible[required][name*="dob" i]'
            );

            if (dobRequiredField && !booking.passengerDOB) {
              await newPage.screenshot({
                path: path.join(
                  __dirname,
                  "../../screenshots/details_submit_blocked.png"
                ),
                fullPage: true,
              });
              throw new Error(
                "Booking.com requires Date of Birth for this reservation. Please provide passengerDOB in the booking."
              );
            }

            if (booking.passengerDOB) {
              const dobFilled = await tryFillDob();
              if (!dobFilled && dobRequiredField) {
                await newPage.screenshot({
                  path: path.join(
                    __dirname,
                    "../../screenshots/details_submit_blocked.png"
                  ),
                  fullPage: true,
                });
                throw new Error(
                  "Date of Birth appears required but could not be filled automatically."
                );
              }
            }
          } catch (e) {
            throw e;
          }

          // Select required radio buttons
          console.log("   📻 Selecting required radio buttons...");

          // "Who are you booking for?" - Select "I'm the main guest"
          try {
            const mainGuestRadio = await newPage.$(
              'input[name="notstayer"][value=""]'
            );
            if (!mainGuestRadio) {
              // Try first radio in the group
              const notStayerRadios = await newPage.$$(
                'input[name="notstayer"]'
              );
              if (notStayerRadios.length > 0) {
                await notStayerRadios[0].click();
                console.log("   ✓ Selected: I'm the main guest");
              }
            } else if (await mainGuestRadio.isVisible()) {
              await mainGuestRadio.click();
              console.log("   ✓ Selected: I'm the main guest");
            }
          } catch (e) {
            console.log("   ℹ️ Could not find 'notstayer' radio button");
          }

          // "Are you traveling for work?" - Select "No" (leisure)
          try {
            const leisureRadio = await newPage.$(
              'input[name="bp_travel_purpose"][value="leisure"]'
            );
            if (!leisureRadio) {
              // Try second radio (usually "No" for work)
              const travelPurposeRadios = await newPage.$$(
                'input[name="bp_travel_purpose"]'
              );
              if (travelPurposeRadios.length > 1) {
                await travelPurposeRadios[1].click();
                console.log("   ✓ Selected: Traveling for leisure");
              }
            } else if (await leisureRadio.isVisible()) {
              await leisureRadio.click();
              console.log("   ✓ Selected: Traveling for leisure");
            }
          } catch (e) {
            console.log(
              "   ℹ️ Could not find 'bp_travel_purpose' radio button"
            );
          }

          // Arrival time is often required (checkin_eta_hour / checkin_eta_minute)
          try {
            const etaHour = await newPage.$('select[name="checkin_eta_hour"]');
            if (etaHour && (await etaHour.isVisible())) {
              // Pick a safe value if present, otherwise the first non-empty option
              await etaHour.selectOption({ value: "12" }).catch(async () => {
                await etaHour.selectOption({ index: 1 }).catch(async () => {
                  await etaHour.selectOption({ index: 0 });
                });
              });
              console.log("   ✓ Selected arrival hour");

              // Some pages render minutes only after hour is chosen
              await newPage.waitForTimeout(250);
            }

            const etaMinute = await newPage.$(
              'select[name="checkin_eta_minute"]'
            );
            if (etaMinute && (await etaMinute.isVisible())) {
              await etaMinute.selectOption({ value: "00" }).catch(async () => {
                await etaMinute.selectOption({ value: "0" }).catch(async () => {
                  await etaMinute.selectOption({ index: 1 }).catch(async () => {
                    await etaMinute.selectOption({ index: 0 });
                  });
                });
              });
              console.log("   ✓ Selected arrival minute");
            }
          } catch (e) {
            // Not always present
          }

          // Wait a bit for any dynamic updates
          await newPage.waitForTimeout(1000);

          // Take screenshot of filled form
          await newPage.screenshot({
            path: path.join(
              __dirname,
              "../../screenshots/details_form_filled.png"
            ),
          });
          console.log("   📸 Screenshot of filled details form saved");

          // Click "Next" or "Continue" button to proceed to payment
          console.log("   🔘 Looking for Next/Continue button...");

          const dumpDetailsBlockingDiagnostics = async () => {
            // Some required fields are hidden behind a "Show fields" expander.
            // Try to expand it BEFORE collecting invalid-field diagnostics.
            try {
              const showSelectors = [
                'button:has-text("Show fields")',
                'a:has-text("Show fields")',
                '[role="button"]:has-text("Show fields")',
              ];
              for (const s of showSelectors) {
                const el = await newPage.$(s);
                if (el && (await el.isVisible())) {
                  await el.click().catch(() => {});
                  await newPage.waitForTimeout(800);
                  break;
                }
              }
            } catch (e) {}

            await newPage.screenshot({
              path: path.join(
                __dirname,
                "../../screenshots/details_submit_blocked.png"
              ),
              fullPage: true,
            });

            const diagnostics = await newPage.evaluate(() => {
              const pickLabel = (el) => {
                try {
                  const id = el.getAttribute("id");
                  if (id) {
                    const byFor = document.querySelector(
                      `label[for="${CSS.escape(id)}"]`
                    );
                    if (byFor && (byFor.textContent || "").trim()) {
                      return (byFor.textContent || "").trim();
                    }
                  }
                } catch (e) {}

                const wrap = el.closest("label");
                if (wrap && (wrap.textContent || "").trim()) {
                  return (wrap.textContent || "").trim();
                }
                return null;
              };

              const invalid = Array.from(
                document.querySelectorAll(
                  "input:invalid, select:invalid, textarea:invalid"
                )
              ).map((el) => ({
                tag: el.tagName,
                type: el.type,
                name: el.getAttribute("name") || "",
                id: el.getAttribute("id") || "",
                required: el.required || false,
                ariaInvalid: el.getAttribute("aria-invalid") || "",
                label: pickLabel(el),
                validationMessage: el.validationMessage || "",
              }));

              const ariaInvalid = Array.from(
                document.querySelectorAll('[aria-invalid="true"]')
              ).map((el) => ({
                tag: el.tagName,
                type: el.type,
                name: el.getAttribute("name") || "",
                id: el.getAttribute("id") || "",
                required: el.required || false,
                ariaInvalid: "true",
                label: pickLabel(el),
                validationMessage: el.validationMessage || "",
              }));

              const errorTexts = Array.from(
                new Set(
                  Array.from(
                    document.querySelectorAll(
                      '[role="alert"], .bui-form__error, .bui-alert--error, [data-testid*="error"]'
                    )
                  )
                    .map((n) => (n.textContent || "").trim())
                    .filter(Boolean)
                )
              ).slice(0, 10);

              return {
                invalid: invalid.slice(0, 12),
                ariaInvalid: ariaInvalid.slice(0, 12),
                errorTexts,
              };
            });

            const stillStage = (() => {
              try {
                return new URL(newPage.url()).searchParams.get("stage");
              } catch (e) {
                return null;
              }
            })();

            console.log(
              `   ❌ Details step did not advance (still stage=${
                stillStage || "?"
              })`
            );

            if (diagnostics?.invalid?.length) {
              console.log("   ❌ Invalid required fields (HTML5 :invalid):");
              for (const f of diagnostics.invalid) {
                console.log(
                  `      - ${
                    f.label || f.name || f.id || "(unknown)"
                  }: ${String(f.validationMessage || "").replace(/\s+/g, " ")}`
                );
              }
            }

            if (diagnostics?.ariaInvalid?.length) {
              console.log("   ❌ Fields marked aria-invalid=true:");
              for (const f of diagnostics.ariaInvalid) {
                console.log(
                  `      - ${f.label || f.name || f.id || "(unknown)"}`
                );
              }
            }

            if (diagnostics?.errorTexts?.length) {
              console.log("   ❌ Inline error messages:");
              for (const msg of diagnostics.errorTexts) {
                console.log(
                  `      - ${msg.replace(/\s+/g, " ").slice(0, 200)}`
                );
              }
            }

            return diagnostics;
          };

          const maybeExpandRequiredFields = async () => {
            const showSelectors = [
              'button:has-text("Show fields")',
              'a:has-text("Show fields")',
              '[role="button"]:has-text("Show fields")',
            ];
            for (const s of showSelectors) {
              const el = await newPage.$(s);
              if (el && (await el.isVisible())) {
                await el.click().catch(() => {});
                await newPage.waitForTimeout(800);
                return true;
              }
            }
            return false;
          };

          const nextButtonSelectors = [
            'button:has-text("Next")',
            'button:has-text("Continue")',
            'button:has-text("Final details")',
            'button:has-text("Proceed")',
            '[data-testid="next-button"]',
            'a:has-text("Next")',
          ];

          let nextClicked = false;
          for (const selector of nextButtonSelectors) {
            let didClick = false;
            try {
              const btn = await newPage.$(selector);
              if (btn) {
                const isVisible = await btn.isVisible();
                if (isVisible) {
                  const buttonText = await btn.textContent();

                  // Don't click "Search" button - we're not on the right page
                  if (buttonText.toLowerCase().includes("search")) {
                    console.log(
                      `   ⚠️ Skipping "${buttonText}" button (not a booking form button)`
                    );
                    continue;
                  }

                  const beforeUrl = newPage.url();
                  let beforeStageNum = 1;
                  try {
                    beforeStageNum = parseInt(
                      new URL(beforeUrl).searchParams.get("stage") || "1",
                      10
                    );
                  } catch (e) {}

                  // Expand required fields if Booking.com hides them behind "Show fields"
                  await maybeExpandRequiredFields().catch(() => {});

                  await Promise.all([
                    newPage
                      .waitForNavigation({
                        waitUntil: "domcontentloaded",
                        timeout: 15000,
                      })
                      .catch(() => {}),
                    (async () => {
                      didClick = true;
                      await btn.click();
                    })(),
                  ]);
                  console.log(
                    `   ✓ Clicked button: "${buttonText.trim()}" (${selector})`
                  );

                  // Wait for stage to advance OR payment indicators to appear.
                  // IMPORTANT: URL changes alone are not enough (Booking may change params but keep stage=1).
                  try {
                    await newPage.waitForFunction(
                      ({ beforeStageNum }) => {
                        const href = window.location.href;
                        let stageNum = 1;
                        try {
                          stageNum = parseInt(
                            new URL(href).searchParams.get("stage") || "1",
                            10
                          );
                        } catch (e) {}

                        if (stageNum > beforeStageNum) return true;

                        // Leaving details step (firstname field disappears)
                        const first = document.querySelector(
                          'input[name="firstname"], input[name="firstName"], input[name="first_name"]'
                        );
                        if (!first || first.offsetParent === null) return true;

                        // Payment indicators
                        if (
                          document.querySelector(
                            'input[autocomplete*="cc-number"], [data-testid="payment-methods"], [data-testid*="payment"]'
                          )
                        ) {
                          return true;
                        }

                        return false;
                      },
                      { timeout: 20000 },
                      { beforeStageNum }
                    );
                  } catch (e) {
                    const diagnostics = await dumpDetailsBlockingDiagnostics();

                    const dobRequired = (diagnostics?.invalid || []).some((f) =>
                      /date\s*of\s*birth/i.test(
                        String(f.label || f.name || f.id || "")
                      )
                    );

                    if (dobRequired && !booking.passengerDOB) {
                      throw new Error(
                        "Booking.com requires Date of Birth for this reservation. Please provide passengerDOB in the booking."
                      );
                    }

                    if (dobRequired && booking.passengerDOB) {
                      await maybeExpandRequiredFields();
                      const dobFilled = await tryFillDob().catch(() => false);

                      if (dobFilled) {
                        await Promise.all([
                          newPage
                            .waitForNavigation({
                              waitUntil: "domcontentloaded",
                              timeout: 15000,
                            })
                            .catch(() => {}),
                          btn.click().catch(() => {}),
                        ]);
                        await newPage.waitForTimeout(1500);
                        // Let the normal stage post-check run
                      } else {
                        throw new Error(
                          "Details step blocked by required Date of Birth field that could not be filled."
                        );
                      }
                    } else {
                      throw new Error(
                        "Details step did not advance (stage stayed the same)"
                      );
                    }
                  }

                  // Post-check: Booking sometimes keeps stage=1 even after moving to payment.
                  // Treat success as: stage increases OR firstname field disappears OR payment UI appears.
                  await newPage.waitForTimeout(3000);
                  {
                    const progress = await newPage
                      .evaluate(
                        ({ beforeStageNum }) => {
                          const href = window.location.href;
                          let stageNum = 1;
                          try {
                            stageNum = parseInt(
                              new URL(href).searchParams.get("stage") || "1",
                              10
                            );
                          } catch (e) {}

                          const first = document.querySelector(
                            'input[name="firstname"], input[name="firstName"], input[name="first_name"]'
                          );
                          const firstVisible =
                            !!first &&
                            (first.offsetParent !== null ||
                              first.clientHeight > 0);

                          const paymentVisible = !!document.querySelector(
                            'input[autocomplete*="cc-number"], [data-testid="payment-methods"], [data-testid*="payment"]'
                          );

                          return {
                            stageNum,
                            stageAdvanced: stageNum > beforeStageNum,
                            leftDetails: !firstVisible,
                            paymentVisible,
                          };
                        },
                        { beforeStageNum }
                      )
                      .catch(() => ({
                        stageNum: 1,
                        stageAdvanced: false,
                        leftDetails: false,
                        paymentVisible: false,
                      }));

                    if (
                      !progress.stageAdvanced &&
                      !progress.leftDetails &&
                      !progress.paymentVisible
                    ) {
                      const diagnostics =
                        await dumpDetailsBlockingDiagnostics();

                      const dobRequired = (diagnostics?.invalid || []).some(
                        (f) =>
                          /date\s*of\s*birth/i.test(
                            String(f.label || f.name || f.id || "")
                          )
                      );

                      if (dobRequired && !booking.passengerDOB) {
                        throw new Error(
                          "Booking.com requires Date of Birth for this reservation. Please provide passengerDOB in the booking."
                        );
                      }

                      if (dobRequired && booking.passengerDOB) {
                        await maybeExpandRequiredFields();
                        const dobFilled = await tryFillDob().catch(() => false);
                        if (!dobFilled) {
                          throw new Error(
                            "Details step blocked by required Date of Birth field that could not be filled."
                          );
                        }

                        await Promise.all([
                          newPage
                            .waitForNavigation({
                              waitUntil: "domcontentloaded",
                              timeout: 15000,
                            })
                            .catch(() => {}),
                          btn.click().catch(() => {}),
                        ]);
                        await newPage.waitForTimeout(2500);

                        const retryProgress = await newPage
                          .evaluate(
                            ({ beforeStageNum }) => {
                              const href = window.location.href;
                              let stageNum = 1;
                              try {
                                stageNum = parseInt(
                                  new URL(href).searchParams.get("stage") ||
                                    "1",
                                  10
                                );
                              } catch (e) {}

                              const first = document.querySelector(
                                'input[name="firstname"], input[name="firstName"], input[name="first_name"]'
                              );
                              const firstVisible =
                                !!first &&
                                (first.offsetParent !== null ||
                                  first.clientHeight > 0);

                              const paymentVisible = !!document.querySelector(
                                'input[autocomplete*="cc-number"], [data-testid="payment-methods"], [data-testid*="payment"]'
                              );

                              return {
                                stageNum,
                                stageAdvanced: stageNum > beforeStageNum,
                                leftDetails: !firstVisible,
                                paymentVisible,
                              };
                            },
                            { beforeStageNum }
                          )
                          .catch(() => ({
                            stageNum: 1,
                            stageAdvanced: false,
                            leftDetails: false,
                            paymentVisible: false,
                          }));

                        if (
                          !retryProgress.stageAdvanced &&
                          !retryProgress.leftDetails &&
                          !retryProgress.paymentVisible
                        ) {
                          throw new Error(
                            `Details step still did not advance after DOB fill (stage=${retryProgress.stageNum})`
                          );
                        }
                      } else {
                        throw new Error(
                          `Details step did not advance (stage=${progress.stageNum})`
                        );
                      }
                    }
                  }

                  await newPage.waitForTimeout(2000);

                  // If stage advanced, no need to treat generic banners as validation.

                  nextClicked = true;
                  break;
                }
              }
            } catch (e) {
              // If we actually clicked a Next/Continue button and still failed, don't silently try other buttons.
              if (didClick) {
                throw e;
              }
            }
          }

          if (!nextClicked) {
            console.log(
              "   ⚠️ Could not find Next button - taking screenshot for debugging"
            );
            await newPage.screenshot({
              path: path.join(
                __dirname,
                "../../screenshots/no_next_button.png"
              ),
            });
          }
        } else {
          console.log(
            "   ℹ️ No details page detected (may already be on payment page)"
          );
        }

        // Take screenshot before looking for payment page
        await newPage.screenshot({
          path: path.join(
            __dirname,
            "../../screenshots/before_payment_search.png"
          ),
        });
        console.log("   📸 Screenshot before payment search saved");

        // Check if we're on final details/review page (not payment page yet)
        console.log("   🔍 Checking current page...");
        const currentPageText = await newPage.evaluate(
          () => document.body.innerText
        );
        const currentPageUrl = newPage.url();
        const lowerCurrentPageText = currentPageText.toLowerCase();

        console.log(`   📄 Current URL: ${currentPageUrl}`);

        // If on final details/review page, look for button to proceed to payment
        let currentStage = null;
        try {
          currentStage = new URL(currentPageUrl).searchParams.get("stage");
        } catch (e) {}

        const looksLikeFinalDetails =
          lowerCurrentPageText.includes("final details") ||
          lowerCurrentPageText.includes("review your booking") ||
          lowerCurrentPageText.includes("confirm and pay") ||
          lowerCurrentPageText.includes("finish booking");

        if (
          looksLikeFinalDetails &&
          // Some flows omit the stage param entirely; treat null as eligible.
          (currentStage === null || currentStage !== "1")
        ) {
          console.log(
            "   📋 On final details/review page - looking for proceed button..."
          );

          const proceedButtonSelectors = [
            'button:has-text("Complete booking")',
            'button:has-text("Confirm and pay")',
            'button:has-text("Proceed to payment")',
            'button:has-text("Go to final step")',
            'button:has-text("Continue")',
            'a:has-text("Continue")',
          ];

          let proceedClicked = false;
          for (const selector of proceedButtonSelectors) {
            try {
              const btn = await newPage.$(selector);
              if (btn && (await btn.isVisible())) {
                const btnText = await btn.textContent();

                // Avoid re-clicking the previous-step button label
                if (
                  (btnText || "").toLowerCase().includes("next: final details")
                ) {
                  continue;
                }

                // Skip navigation buttons
                if (
                  btnText.toLowerCase().includes("back") ||
                  btnText.toLowerCase().includes("cancel")
                ) {
                  continue;
                }

                await btn.click();
                console.log(`   ✓ Clicked proceed button: "${btnText.trim()}"`);
                await newPage.waitForTimeout(5000);

                // Take screenshot after clicking
                await newPage.screenshot({
                  path: path.join(
                    __dirname,
                    "../../screenshots/after_proceed_click.png"
                  ),
                });
                console.log("   📸 Screenshot after proceed click saved");

                proceedClicked = true;
                break;
              }
            } catch (e) {}
          }

          if (!proceedClicked) {
            console.log(
              "   ⚠️ Could not find proceed button on final details page"
            );
          }
        }

        // Wait for checkout/payment page (avoid hidden forms)
        console.log("   💳 Looking for payment page...");
        let paymentReached = false;
        let paymentFilledScreenshotPath = null;
        try {
          const paymentReadySelectors = [
            // Non-iframe forms
            'input[autocomplete="cc-number"]',
            'input[autocomplete*="cc-number" i]',
            'input[name*="cc_number" i]',
            'input[name*="cc"]',
            // Hosted fields (often inside iframes)
            'input[name="encryptedCardNumber"]',
            'input[name="encryptedExpiryDate"]',
            'input[name="encryptedSecurityCode"]',
            // Generic hosted inputs
            'input[aria-label*="card number" i]',
            'input[placeholder*="card number" i]',
          ];

          const anyFrameHas = async (selectors) => {
            for (const frame of newPage.frames()) {
              for (const sel of selectors) {
                try {
                  const h = await frame.$(sel);
                  if (h) return true;
                } catch (e) {}
              }
            }
            return false;
          };

          const waitForPaymentReady = async (timeoutMs = 45000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
              // Require actual inputs (not just a container) to avoid premature success.
              if (await anyFrameHas(paymentReadySelectors)) return true;
              await newPage.waitForTimeout(500);
            }
            return false;
          };

          const ready = await waitForPaymentReady(45000);
          if (!ready) {
            throw new Error("Payment inputs not visible (possibly in iframes)");
          }
          console.log("   ✓ Reached payment page");
          paymentReached = true;

          // Fill credit card details from environment variables
          const cardNumber = process.env.CARD_NUMBER;
          const cardHolder =
            process.env.CARD_HOLDER || process.env.CARD_HOLDER_NAME;
          const cardExpMonth = process.env.CARD_EXP_MONTH;
          const cardExpYear = process.env.CARD_EXP_YEAR;
          const cardCVC = process.env.CARD_CVC || process.env.CARD_CVV;
          const billingPostal =
            process.env.CARD_BILLING_POSTAL_CODE ||
            process.env.CARD_BILLING_ZIP ||
            process.env.CARD_POSTAL_CODE ||
            process.env.CARD_ZIP;
          const billingAddress =
            process.env.CARD_BILLING_ADDRESS || process.env.CARD_ADDRESS;
          const billingCity =
            process.env.CARD_BILLING_CITY || process.env.CARD_CITY;
          const billingState =
            process.env.CARD_BILLING_STATE || process.env.CARD_STATE;
          const billingCountryCode =
            process.env.CARD_BILLING_COUNTRY_CODE || process.env.CARD_COUNTRY;

          if (cardNumber && cardHolder) {
            // DOB is sometimes present on the same page as payment.
            if (booking.passengerDOB) {
              const fillDobOnPayment = async () => {
                const dob = new Date(booking.passengerDOB);
                if (Number.isNaN(dob.getTime())) return false;
                const yyyy = String(dob.getFullYear());
                const mm = String(dob.getMonth() + 1).padStart(2, "0");
                const dd = String(dob.getDate()).padStart(2, "0");
                const mdy = `${mm}/${dd}/${yyyy}`;

                const selectors = [
                  'input[placeholder*="MM/DD/YYYY" i]',
                  'input[aria-label*="date of birth" i]',
                  'input[name*="birth" i]',
                  'input[name*="dob" i]',
                  'input[id*="birth" i]',
                  'input[id*="dob" i]',
                ];

                for (const sel of selectors) {
                  const el = await newPage.$(sel);
                  if (el && (await el.isVisible())) {
                    await el.scrollIntoViewIfNeeded().catch(() => {});
                    await el.click({ clickCount: 3 }).catch(() => {});
                    await el.fill("").catch(() => {});
                    await el.type(mdy, { delay: 25 }).catch(async () => {
                      await el.fill(mdy);
                    });
                    const actual = await el
                      .evaluate((n) => String(n.value || "").trim())
                      .catch(() => "");
                    if (actual) {
                      const yearMatch = actual.match(/(\d{4})/);
                      if (yearMatch && yearMatch[1] === yyyy) {
                        console.log(`   ✓ Filled date of birth: ${actual}`);
                        return true;
                      }
                    }
                  }
                }

                // Label-based fallback
                try {
                  const handle = await newPage.evaluateHandle(() => {
                    const labels = Array.from(
                      document.querySelectorAll("label")
                    );
                    const label = labels.find((l) =>
                      /date\s*of\s*birth/i.test((l.textContent || "").trim())
                    );
                    if (!label) return null;
                    const forId = label.getAttribute("for");
                    if (forId) return document.getElementById(forId);
                    return (
                      label.querySelector("input") ||
                      label.closest("div")?.querySelector("input") ||
                      null
                    );
                  });
                  const el = handle.asElement();
                  if (el) {
                    await el.scrollIntoViewIfNeeded().catch(() => {});
                    await el.click({ clickCount: 3 }).catch(() => {});
                    await el.fill("").catch(() => {});
                    await el.type(mdy, { delay: 25 }).catch(async () => {
                      await el.fill(mdy);
                    });
                    const actual = await el
                      .evaluate((n) => String(n.value || "").trim())
                      .catch(() => "");
                    if (actual) {
                      const yearMatch = actual.match(/(\d{4})/);
                      if (yearMatch && yearMatch[1] === yyyy) {
                        console.log(`   ✓ Filled date of birth: ${actual}`);
                        return true;
                      }
                    }
                  }
                } catch (e) {}

                return false;
              };

              await fillDobOnPayment().catch(() => false);
            }

            const fillPaymentField = async ({
              labelRegex,
              selectors,
              value,
            }) => {
              if (!value) return false;

              // 1) Try label-based (best when inputs are in main document)
              try {
                const loc = newPage.getByLabel(labelRegex, { exact: false });
                if (
                  await loc
                    .first()
                    .isVisible()
                    .catch(() => false)
                ) {
                  const first = loc.first();
                  await first.click({ timeout: 2000 }).catch(() => {});
                  await first.fill("").catch(() => {});
                  await first
                    .type(String(value), { delay: 25 })
                    .catch(async () => {
                      await first.fill(String(value)).catch(() => {});
                    });
                  return true;
                }
              } catch (e) {
                // ignore
              }

              // 2) Try direct selectors in main document
              for (const sel of selectors || []) {
                try {
                  const el = await newPage.$(sel);
                  if (el && (await el.isVisible())) {
                    await el.click({ clickCount: 3 }).catch(() => {});
                    await el.fill("").catch(() => {});
                    await el
                      .type(String(value), { delay: 25 })
                      .catch(async () => {
                        await el.fill(String(value)).catch(() => {});
                      });
                    return true;
                  }
                } catch (e) {}
              }

              // 3) Iframe-hosted fields: locate iframe by title/name heuristics
              const iframeTitleHints = {
                number: [/card\s*number/i, /number/i],
                expiry: [/expir/i, /mm\s*\/\s*yy/i],
                cvc: [/cvc/i, /cvv/i, /security/i],
              };

              const kind = /card\s*number/i.test(String(labelRegex))
                ? "number"
                : /expir/i.test(String(labelRegex))
                ? "expiry"
                : /cvc|cvv|security/i.test(String(labelRegex))
                ? "cvc"
                : null;

              if (kind) {
                const frames = newPage.frames();
                for (const frame of frames) {
                  const frameName = (frame.name() || "").toLowerCase();
                  const frameUrl = (frame.url() || "").toLowerCase();
                  const hints = iframeTitleHints[kind] || [];

                  const likely =
                    hints.some((re) => re.test(frameName)) ||
                    hints.some((re) => re.test(frameUrl)) ||
                    /adyen|checkout|payment|card/i.test(frameName) ||
                    /adyen|checkout|payment|card/i.test(frameUrl);

                  if (!likely) continue;

                  // Look for any visible input inside the frame
                  try {
                    const input = await frame.$('input:not([type="hidden"])');
                    if (input) {
                      await input.click().catch(() => {});
                      await input.fill("").catch(() => {});
                      await input
                        .type(String(value), { delay: 25 })
                        .catch(async () => {
                          await input.fill(String(value)).catch(() => {});
                        });
                      return true;
                    }
                  } catch (e) {}
                }
              }

              return false;
            };

            const collectPaymentErrors = async () => {
              try {
                const errs = await newPage.evaluate(() => {
                  const msgs = Array.from(
                    document.querySelectorAll(
                      '[role="alert"], .bui-form__error, .bui-alert--error, [data-testid*="error"], .bui-form__control__error'
                    )
                  )
                    .map((n) => (n.textContent || "").trim())
                    .filter(Boolean);
                  return Array.from(new Set(msgs)).slice(0, 20);
                });
                return Array.isArray(errs) ? errs : [];
              } catch (e) {
                return [];
              }
            };

            const clickShowFieldsIfPresent = async () => {
              const selectors = [
                'button:has-text("Show fields")',
                'a:has-text("Show fields")',
                'button:has-text("Show")',
              ];
              for (const sel of selectors) {
                try {
                  const el = await newPage.$(sel);
                  if (el && (await el.isVisible())) {
                    await el.click().catch(() => {});
                    await newPage.waitForTimeout(600);
                    return true;
                  }
                } catch (e) {}
              }
              return false;
            };

            const describeMissingRequiredFields = async () => {
              try {
                return await newPage.evaluate(() => {
                  const isVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (
                      style.visibility === "hidden" ||
                      style.display === "none"
                    )
                      return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                  };

                  const getLabelText = (el) => {
                    const id = el.getAttribute("id");
                    if (id) {
                      const lab = document.querySelector(`label[for="${id}"]`);
                      if (lab) return (lab.textContent || "").trim();
                    }
                    const wrapping = el.closest("label");
                    if (wrapping) return (wrapping.textContent || "").trim();
                    const group = el.closest(
                      '[data-testid*="form"], [class*="form"], [class*="bui-form"], fieldset, .bui-form__group'
                    );
                    if (group) {
                      const l = group.querySelector("label");
                      if (l) return (l.textContent || "").trim();
                    }
                    return "";
                  };

                  const hasErrorStyling = (el) => {
                    const c = el.closest(
                      '[class*="error"], [class*="invalid"], .bui-form__group--error, .bui-form__control--error'
                    );
                    return Boolean(c);
                  };

                  const candidates = Array.from(
                    document.querySelectorAll("input, select, textarea")
                  ).filter((el) => {
                    if (!isVisible(el)) return false;
                    const type = (el.getAttribute("type") || "").toLowerCase();
                    if (type === "hidden") return false;
                    const required =
                      el.hasAttribute("required") ||
                      el.getAttribute("aria-required") === "true";
                    const invalid = el.getAttribute("aria-invalid") === "true";
                    const errorStyled = hasErrorStyling(el);
                    if (!(required || invalid || errorStyled)) return false;

                    if (type === "checkbox" || type === "radio") {
                      return !el.checked;
                    }

                    const v = (el.value || "").trim();
                    return v.length === 0;
                  });

                  return candidates.slice(0, 25).map((el) => ({
                    label: getLabelText(el),
                    name: el.getAttribute("name") || "",
                    id: el.getAttribute("id") || "",
                    placeholder: el.getAttribute("placeholder") || "",
                    autocomplete: el.getAttribute("autocomplete") || "",
                    type: (el.getAttribute("type") || "").toLowerCase(),
                    tag: el.tagName.toLowerCase(),
                  }));
                });
              } catch (e) {
                return [];
              }
            };

            const tickRequiredConsentCheckboxes = async () => {
              try {
                const did = await newPage.evaluate(() => {
                  const isVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (
                      style.visibility === "hidden" ||
                      style.display === "none"
                    )
                      return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                  };

                  const want = [
                    /i\s*agree/i,
                    /terms/i,
                    /conditions/i,
                    /privacy/i,
                    /booking\s*conditions/i,
                    /general\s*terms/i,
                    /consent/i,
                  ];
                  const avoid = [/marketing/i, /newsletter/i];

                  const inputs = Array.from(
                    document.querySelectorAll(
                      'input[type="checkbox"], input[type="radio"]'
                    )
                  ).filter(isVisible);

                  let clicks = 0;
                  for (const input of inputs) {
                    if (input.checked) continue;

                    const required =
                      input.hasAttribute("required") ||
                      input.getAttribute("aria-required") === "true" ||
                      input.getAttribute("aria-invalid") === "true" ||
                      Boolean(
                        input.closest(
                          '.bui-form__group--error, .bui-form__control--error, [class*="error"], [class*="invalid"]'
                        )
                      );

                    const container =
                      input.closest("label") ||
                      input.closest(
                        '[data-testid*="form"], [class*="form"], [class*="bui-form"], fieldset, .bui-form__group'
                      ) ||
                      input.parentElement;
                    const txt = (container?.textContent || "").trim();

                    const isWanted = want.some((re) => re.test(txt));
                    const isAvoid = avoid.some((re) => re.test(txt));

                    if (required && isWanted && !isAvoid) {
                      (container || input).click();
                      clicks += 1;
                      if (clicks >= 5) break;
                    }
                  }

                  return clicks;
                });

                if (did) {
                  console.log(
                    `   ✓ Ticked ${did} required consent checkbox(es)`
                  );
                }
                return did;
              } catch (e) {
                return 0;
              }
            };

            const fillCardholderNameStrong = async () => {
              if (!cardHolder) return false;

              // 1) Standard label/selector fill (main document)
              const filled = await fillPaymentField({
                labelRegex:
                  /cardholder'?s\s*name|cardholder\s*name|cardholder/i,
                selectors: [
                  'input[autocomplete="cc-name"]',
                  'input[placeholder*="Cardholder" i]',
                  'input[placeholder*="Card holder" i]',
                  'input[aria-label*="cardholder" i]',
                  'input[aria-label*="Cardholder" i]',
                  'input[name*="cc_name" i]',
                  'input[name*="cardholder" i]',
                  'input[name*="holder" i]',
                ],
                value: String(cardHolder),
              });
              if (filled) return true;

              // 2) DOM proximity fallback for Booking.com’s “Cardholder’s name” field
              try {
                const handle = await newPage.evaluateHandle(() => {
                  const needles = [
                    /cardholder'?s\s*name/i,
                    /cardholder\s*name/i,
                    /name\s*on\s*card/i,
                  ];

                  const isVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (
                      style.visibility === "hidden" ||
                      style.display === "none"
                    )
                      return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                  };

                  // Prefer a label element if present
                  const labels = Array.from(document.querySelectorAll("label"));
                  for (const l of labels) {
                    const txt = (l.textContent || "").trim();
                    if (!needles.some((re) => re.test(txt))) continue;
                    const forId = l.getAttribute("for");
                    if (forId) {
                      const el = document.getElementById(forId);
                      if (el && el.tagName.toLowerCase() === "input") return el;
                    }
                    const input =
                      l.querySelector('input:not([type="hidden"])') ||
                      l
                        .closest("div")
                        ?.querySelector('input:not([type="hidden"])');
                    if (input) return input;
                  }

                  // Otherwise find a nearby text node and the next input
                  const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT
                  );
                  const texts = [];
                  while (walker.nextNode()) {
                    const t = (walker.currentNode.nodeValue || "").trim();
                    if (!t) continue;
                    if (needles.some((re) => re.test(t))) {
                      texts.push(walker.currentNode);
                      if (texts.length >= 10) break;
                    }
                  }

                  for (const node of texts) {
                    const el = node.parentElement;
                    const container = el?.closest(
                      'div, section, fieldset, form, [class*="form"], [class*="bui-form"]'
                    );
                    const input =
                      container?.querySelector(
                        'input[autocomplete="cc-name"]'
                      ) ||
                      container?.querySelector(
                        'input:not([type="hidden"]):not([disabled])'
                      );
                    if (input && isVisible(input)) return input;
                  }

                  // Last resort: placeholder match
                  const inputs = Array.from(
                    document.querySelectorAll('input:not([type="hidden"])')
                  ).filter(isVisible);
                  return (
                    inputs.find((i) =>
                      /cardholder/i.test(i.getAttribute("placeholder") || "")
                    ) || null
                  );
                });

                const el = handle.asElement();
                if (el) {
                  await el.scrollIntoViewIfNeeded().catch(() => {});
                  await el.click({ clickCount: 3 }).catch(() => {});
                  await el.fill("").catch(() => {});
                  await el
                    .type(String(cardHolder), { delay: 25 })
                    .catch(async () => {
                      await el.fill(String(cardHolder)).catch(() => {});
                    });

                  const actual = await el
                    .evaluate((n) => String(n.value || "").trim())
                    .catch(() => "");
                  if (actual) {
                    console.log(`   ✓ Cardholder field now: ${actual}`);
                  }
                  return true;
                }
              } catch (e) {}

              return false;
            };

            const fillRequiredBillingFieldsIfVisible = async () => {
              // Try best-effort based on env. If env doesn't provide the field, we still log missing.
              const fillByLabel = async (labelRe, value) => {
                if (!value) return false;
                return await fillPaymentField({
                  labelRegex: labelRe,
                  selectors: [],
                  value: String(value),
                });
              };

              const tried = [];
              const did = [];

              if (billingAddress) {
                tried.push("billingAddress");
                if (await fillByLabel(/address/i, billingAddress)) {
                  did.push("address");
                  console.log("   ✓ Filled billing address (label-based)");
                }
              }
              if (billingCity) {
                tried.push("billingCity");
                if (await fillByLabel(/city|town/i, billingCity)) {
                  did.push("city");
                  console.log("   ✓ Filled billing city (label-based)");
                }
              }
              if (billingState) {
                tried.push("billingState");
                if (await fillByLabel(/state|region|province/i, billingState)) {
                  did.push("state");
                  console.log("   ✓ Filled billing state/region (label-based)");
                }
              }
              if (billingPostal) {
                tried.push("billingPostal");
                if (await fillByLabel(/postal|zip/i, billingPostal)) {
                  did.push("postal");
                  console.log("   ✓ Filled billing postal code (label-based)");
                }
              }

              // Country is often a select; keep existing selector-based block below.
              return { tried, did };
            };

            const expMonthRaw = String(cardExpMonth || "").trim();
            const expMonthTwo = expMonthRaw ? expMonthRaw.padStart(2, "0") : "";
            const expMonthNoZero = expMonthRaw
              ? String(parseInt(expMonthRaw, 10))
              : "";

            const expYearRaw = String(cardExpYear || "").trim();
            const expYearTwo = expYearRaw ? expYearRaw.slice(-2) : "";
            const expYearFour =
              expYearRaw.length === 2 ? `20${expYearRaw}` : expYearRaw;

            const expCombined =
              expMonthTwo && expYearTwo ? `${expMonthTwo}/${expYearTwo}` : "";

            // Card number
            const cardNumberSelectors = [
              'input[name*="cc_number"]',
              'input[autocomplete="cc-number"]',
              'input[placeholder*="card number"]',
              'input[id*="cardnumber"]',
            ];

            const cardNumberFilled = await fillPaymentField({
              labelRegex: /card\s*number/i,
              selectors: [
                ...cardNumberSelectors,
                'input[name="encryptedCardNumber"]',
                'input[data-field="encryptedCardNumber"]',
              ],
              value: String(cardNumber).replace(/\s+/g, ""),
            });
            if (cardNumberFilled) console.log("   ✓ Filled card number");

            // Cardholder name
            // IMPORTANT: overwrite any prefilled guest name with env cardholder.
            const cardHolderFilledMain = await fillCardholderNameStrong();
            if (cardHolderFilledMain) {
              console.log("   ✓ Filled cardholder name (from env)");
            }

            // Log visible cardholder value if we can find it (helps confirm it's NOT the guest name).
            try {
              const visibleHolderValue = await newPage.evaluate(() => {
                const isVisible = (el) => {
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  if (style.visibility === "hidden" || style.display === "none")
                    return false;
                  const rect = el.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                };
                const needles = [/cardholder'?s\s*name/i, /name\s*on\s*card/i];
                const texts = Array.from(
                  document.querySelectorAll("label, div, span, p")
                ).filter((n) =>
                  needles.some((re) => re.test((n.textContent || "").trim()))
                );
                for (const node of texts) {
                  const container = node.closest(
                    'div, section, fieldset, form, [class*="form"], [class*="bui-form"]'
                  );
                  const input =
                    container?.querySelector('input[autocomplete="cc-name"]') ||
                    container?.querySelector('input:not([type="hidden"])');
                  if (input && isVisible(input)) {
                    return String(input.value || "").trim();
                  }
                }
                return "";
              });
              if (visibleHolderValue) {
                console.log(
                  `   ℹ️ Visible cardholder value: ${visibleHolderValue}`
                );
              }
            } catch (e) {}

            // Expiration date (combined field MM/YY is common)
            if (expCombined) {
              const expFilled = await fillPaymentField({
                labelRegex: /expiration|expiry|expir/i,
                selectors: [
                  'input[autocomplete="cc-exp"]',
                  'input[placeholder*="MM/YY" i]',
                  'input[name="encryptedExpiryDate"]',
                  'input[data-field="encryptedExpiryDate"]',
                ],
                value: expCombined,
              });
              if (expFilled) console.log("   ✓ Filled expiry (MM/YY)");
            }

            // CVC
            if (cardCVC) {
              const cvcFilled = await fillPaymentField({
                labelRegex: /cvc|cvv|security\s*code/i,
                selectors: [
                  'input[autocomplete="cc-csc"]',
                  'input[placeholder*="CVC" i]',
                  'input[placeholder*="CVV" i]',
                  'input[name="encryptedSecurityCode"]',
                  'input[data-field="encryptedSecurityCode"]',
                ],
                value: String(cardCVC),
              });
              if (cvcFilled) console.log("   ✓ Filled CVC");
            }

            // Hosted/iframe payment fields fallback (e.g., Adyen encrypted inputs)
            const hostedSelectors = {
              number: [
                'input[name="encryptedCardNumber"]',
                'input[name="encryptedCardnumber"]',
                'input[data-field="encryptedCardNumber"]',
                'input[autocomplete="cc-number"]',
                'input[aria-label*="card number" i]',
                'input[placeholder*="card number" i]',
                'input[placeholder*="Card number" i]',
                'input[id*="cardnumber" i]',
              ],
              expiry: [
                'input[name="encryptedExpiryDate"]',
                'input[name="encryptedExpiryMonth"]',
                'input[name="encryptedExpiryYear"]',
                'input[data-field="encryptedExpiryDate"]',
                'input[autocomplete="cc-exp"]',
                'input[aria-label*="expiry" i]',
                'input[aria-label*="expiration" i]',
                'input[placeholder*="MM/YY" i]',
              ],
              cvc: [
                'input[name="encryptedSecurityCode"]',
                'input[data-field="encryptedSecurityCode"]',
                'input[aria-label*="security code" i]',
                'input[aria-label*="cvc" i]',
                'input[placeholder*="CVC" i]',
                'input[placeholder*="CVV" i]',
              ],
              holder: [
                'input[name*="holder" i]',
                'input[autocomplete="cc-name"]',
                'input[aria-label*="cardholder" i]',
                'input[placeholder*="cardholder" i]',
              ],
            };

            const findFirstInFrames = async (selectors) => {
              for (const frame of newPage.frames()) {
                for (const sel of selectors) {
                  try {
                    const h = await frame.$(sel);
                    if (h) return { frame, sel };
                  } catch (e) {}
                }
              }
              return null;
            };

            const hostedNumber = await findFirstInFrames(
              hostedSelectors.number
            );
            const hostedExpiry = await findFirstInFrames(
              hostedSelectors.expiry
            );
            const hostedCvc = await findFirstInFrames(hostedSelectors.cvc);
            const hostedHolder = await findFirstInFrames(
              hostedSelectors.holder
            );

            const findHeuristicInputInFrames = async (regex) => {
              for (const frame of newPage.frames()) {
                try {
                  const handle = await frame.evaluateHandle((reSource) => {
                    const re = new RegExp(reSource, "i");
                    const inputs = Array.from(
                      document.querySelectorAll("input")
                    );
                    const pick = (el) => {
                      const attrs = [
                        el.getAttribute("name") || "",
                        el.getAttribute("id") || "",
                        el.getAttribute("placeholder") || "",
                        el.getAttribute("aria-label") || "",
                        el.getAttribute("autocomplete") || "",
                      ].join(" ");
                      return re.test(attrs);
                    };
                    return inputs.find(pick) || null;
                  }, regex.source);

                  const el = handle.asElement();
                  if (el) return { frame, el };
                } catch (e) {}
              }
              return null;
            };

            const heuristicNumber = hostedNumber
              ? null
              : await findHeuristicInputInFrames(
                  /card\s*number|encryptedcardnumber|cardnumber/
                );
            const heuristicExpiry = hostedExpiry
              ? null
              : await findHeuristicInputInFrames(
                  /expiry|expiration|mm\s*\/\s*yy/
                );
            const heuristicCvc = hostedCvc
              ? null
              : await findHeuristicInputInFrames(/cvc|cvv|security\s*code/);
            const heuristicHolder = hostedHolder
              ? null
              : await findHeuristicInputInFrames(
                  /card\s*holder|cardholder|holder\s*name|name\s*on\s*card/
                );

            if (hostedHolder) {
              await hostedHolder.frame.click(hostedHolder.sel).catch(() => {});
              await hostedHolder.frame
                .fill(hostedHolder.sel, "")
                .catch(() => {});
              await hostedHolder.frame
                .type(hostedHolder.sel, String(cardHolder), { delay: 25 })
                .catch(async () => {
                  await hostedHolder.frame
                    .fill(hostedHolder.sel, String(cardHolder))
                    .catch(() => {});
                });
              console.log("   ✓ Filled cardholder name (iframe-aware)");
            } else if (heuristicHolder) {
              await heuristicHolder.el.click().catch(() => {});
              await heuristicHolder.el.fill("").catch(() => {});
              await heuristicHolder.el
                .type(String(cardHolder), { delay: 25 })
                .catch(async () => {
                  await heuristicHolder.el.fill(String(cardHolder));
                });
              console.log(
                "   ✓ Filled cardholder name (iframe-aware/heuristic)"
              );
            }
            if (hostedNumber) {
              await hostedNumber.frame.click(hostedNumber.sel).catch(() => {});
              await hostedNumber.frame
                .fill(hostedNumber.sel, "")
                .catch(() => {});
              await hostedNumber.frame
                .type(hostedNumber.sel, String(cardNumber), { delay: 25 })
                .catch(async () => {
                  await hostedNumber.frame
                    .fill(hostedNumber.sel, String(cardNumber))
                    .catch(() => {});
                });
              console.log("   ✓ Filled card number (iframe-aware)");
            } else if (heuristicNumber) {
              await heuristicNumber.el.click().catch(() => {});
              await heuristicNumber.el.fill("").catch(() => {});
              await heuristicNumber.el
                .type(String(cardNumber), { delay: 25 })
                .catch(async () => {
                  await heuristicNumber.el.fill(String(cardNumber));
                });
              console.log("   ✓ Filled card number (iframe-aware/heuristic)");
            }
            if (hostedExpiry && expMonthTwo && expYearTwo) {
              // If we matched a combined expiry field, type MM/YY; otherwise separate month/year fields are handled below.
              if (
                /ExpiryDate/i.test(hostedExpiry.sel) ||
                /cc-exp/i.test(hostedExpiry.sel) ||
                /MM\/YY/i.test(hostedExpiry.sel)
              ) {
                await hostedExpiry.frame
                  .click(hostedExpiry.sel)
                  .catch(() => {});
                await hostedExpiry.frame
                  .fill(hostedExpiry.sel, "")
                  .catch(() => {});
                await hostedExpiry.frame
                  .type(hostedExpiry.sel, `${expMonthTwo}/${expYearTwo}`, {
                    delay: 25,
                  })
                  .catch(async () => {
                    await hostedExpiry.frame
                      .fill(hostedExpiry.sel, `${expMonthTwo}/${expYearTwo}`)
                      .catch(() => {});
                  });
                console.log("   ✓ Filled expiry (iframe-aware)");
              }
            } else if (heuristicExpiry && expMonthTwo && expYearTwo) {
              await heuristicExpiry.el.click().catch(() => {});
              await heuristicExpiry.el.fill("").catch(() => {});
              await heuristicExpiry.el
                .type(`${expMonthTwo}/${expYearTwo}`, { delay: 25 })
                .catch(async () => {
                  await heuristicExpiry.el.fill(`${expMonthTwo}/${expYearTwo}`);
                });
              console.log("   ✓ Filled expiry (iframe-aware/heuristic)");
            }
            if (hostedCvc && cardCVC) {
              await hostedCvc.frame.click(hostedCvc.sel).catch(() => {});
              await hostedCvc.frame.fill(hostedCvc.sel, "").catch(() => {});
              await hostedCvc.frame
                .type(hostedCvc.sel, String(cardCVC), { delay: 25 })
                .catch(async () => {
                  await hostedCvc.frame
                    .fill(hostedCvc.sel, String(cardCVC))
                    .catch(() => {});
                });
              console.log("   ✓ Filled CVC (iframe-aware)");
            } else if (heuristicCvc && cardCVC) {
              await heuristicCvc.el.click().catch(() => {});
              await heuristicCvc.el.fill("").catch(() => {});
              await heuristicCvc.el
                .type(String(cardCVC), { delay: 25 })
                .catch(async () => {
                  await heuristicCvc.el.fill(String(cardCVC));
                });
              console.log("   ✓ Filled CVC (iframe-aware/heuristic)");
            }

            // Post-fill: surface validation errors if any (helps debug when fields don't stick)
            let paymentErrors = await collectPaymentErrors();
            if (paymentErrors?.length) {
              console.log("   ⚠️ Payment field validation messages:");
              for (const m of paymentErrors) {
                console.log(`      - ${m.replace(/\s+/g, " ").slice(0, 200)}`);
              }
            }

            // If Booking.com says required fields are missing, click “Show fields” and try to fill billing fields from env.
            if (
              paymentErrors.some((m) =>
                /fill\s+in\s+all\s+required\s+fields/i.test(m)
              )
            ) {
              await clickShowFieldsIfPresent().catch(() => false);
              await fillRequiredBillingFieldsIfVisible().catch(() => ({}));
              await tickRequiredConsentCheckboxes().catch(() => 0);

              const missing = await describeMissingRequiredFields();
              if (missing?.length) {
                console.log("   ⚠️ Missing required fields detected:");
                for (const f of missing) {
                  const label = (f.label || "").replace(/\s+/g, " ").trim();
                  const meta = [f.tag, f.type, f.name, f.id, f.autocomplete]
                    .filter(Boolean)
                    .join("|");
                  console.log(
                    `      - ${
                      label || "(no label)"
                    } [${meta}] placeholder=${JSON.stringify(
                      f.placeholder || ""
                    )}`
                  );
                }
              }

              // Re-check errors after filling.
              await newPage.waitForTimeout(800);
              paymentErrors = await collectPaymentErrors();
              // Screenshot after required-fields retry (useful when Show fields reveals hidden sections)
              try {
                ensureDirExists(path.join(__dirname, "../../screenshots"));
                const ts2 = makeTimestampForFilename();
                const p = path.join(
                  __dirname,
                  `../../screenshots/payment_required_retry_${String(
                    booking._id
                  )}_${ts2}.png`
                );
                await newPage.screenshot({ path: p, fullPage: true });
                console.log(
                  `   📸 Required-fields retry screenshot saved: ${p}`
                );
              } catch (e) {}
              if (paymentErrors?.length) {
                console.log(
                  "   ⚠️ Payment validation after required-fields retry:"
                );
                for (const m of paymentErrors) {
                  console.log(
                    `      - ${m.replace(/\s+/g, " ").slice(0, 200)}`
                  );
                }
              }
            }

            // Screenshot after filling payment fields (for debugging validation errors)
            try {
              ensureDirExists(path.join(__dirname, "../../screenshots"));
              const ts = makeTimestampForFilename();
              paymentFilledScreenshotPath = path.join(
                __dirname,
                `../../screenshots/payment_filled_${String(
                  booking._id
                )}_${ts}.png`
              );
              // Give the UI a moment to render any client-side validation.
              await newPage.waitForTimeout(1200);
              await newPage.screenshot({
                path: paymentFilledScreenshotPath,
                fullPage: true,
              });
              console.log(
                `   📸 Payment-filled screenshot saved: ${paymentFilledScreenshotPath}`
              );
            } catch (e) {
              // ignore screenshot errors
            }

            // Expiry month
            if (expMonthRaw) {
              const monthSelectors = [
                'select[name*="cc_month"]',
                'input[autocomplete="cc-exp-month"]',
                'select[id*="month"]',
              ];

              for (const selector of monthSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  const tagName = await input.evaluate((el) =>
                    el.tagName.toLowerCase()
                  );
                  if (tagName === "select") {
                    await input
                      .selectOption({ value: expMonthTwo })
                      .catch(async () => {
                        await input.selectOption({
                          value: expMonthNoZero,
                        });
                      })
                      .catch(async () => {
                        await input.selectOption({ label: expMonthTwo });
                      })
                      .catch(async () => {
                        await input.selectOption({
                          label: expMonthNoZero,
                        });
                      });
                  } else {
                    await input.fill(expMonthTwo || expMonthRaw);
                  }
                  console.log("   ✓ Filled expiry month");
                  break;
                }
              }
            }

            // Expiry year
            if (expYearRaw) {
              const yearSelectors = [
                'select[name*="cc_year"]',
                'input[autocomplete="cc-exp-year"]',
                'select[id*="year"]',
              ];

              for (const selector of yearSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  const tagName = await input.evaluate((el) =>
                    el.tagName.toLowerCase()
                  );
                  if (tagName === "select") {
                    await input
                      .selectOption({ value: expYearFour })
                      .catch(async () => {
                        await input.selectOption({ value: expYearRaw });
                      })
                      .catch(async () => {
                        await input.selectOption({ value: expYearTwo });
                      })
                      .catch(async () => {
                        await input.selectOption({ label: expYearFour });
                      })
                      .catch(async () => {
                        await input.selectOption({ label: expYearRaw });
                      })
                      .catch(async () => {
                        await input.selectOption({ label: expYearTwo });
                      });
                  } else {
                    await input.fill(expYearFour || expYearRaw);
                  }
                  console.log("   ✓ Filled expiry year");
                  break;
                }
              }
            }

            // CVC
            if (cardCVC) {
              const cvcSelectors = [
                'input[name*="cc_cvc"]',
                'input[autocomplete="cc-csc"]',
                'input[placeholder*="CVC"]',
                'input[id*="cvc"]',
              ];

              for (const selector of cvcSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  await input.fill(cardCVC);
                  console.log("   ✓ Filled CVC");
                  break;
                }
              }
            }

            // Optional billing fields (some payment pages require these)
            if (billingPostal) {
              const postalSelectors = [
                'input[autocomplete="postal-code"]',
                'input[name*="postal" i]',
                'input[name*="zip" i]',
                'input[id*="postal" i]',
                'input[id*="zip" i]',
              ];
              for (const selector of postalSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  await input.fill(String(billingPostal));
                  console.log("   ✓ Filled billing postal code");
                  break;
                }
              }
            }

            if (billingAddress) {
              const addressSelectors = [
                'input[autocomplete="address-line1"]',
                'input[name*="address" i]',
                'input[id*="address" i]',
              ];
              for (const selector of addressSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  await input.fill(String(billingAddress));
                  console.log("   ✓ Filled billing address");
                  break;
                }
              }
            }

            if (billingCity) {
              const citySelectors = [
                'input[autocomplete="address-level2"]',
                'input[name*="city" i]',
                'input[id*="city" i]',
              ];
              for (const selector of citySelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  await input.fill(String(billingCity));
                  console.log("   ✓ Filled billing city");
                  break;
                }
              }
            }

            if (billingState) {
              const stateSelectors = [
                'input[autocomplete="address-level1"]',
                'input[name*="state" i]',
                'input[id*="state" i]',
              ];
              for (const selector of stateSelectors) {
                const input = await newPage.$(selector);
                if (input) {
                  await input.fill(String(billingState));
                  console.log("   ✓ Filled billing state/region");
                  break;
                }
              }
            }

            if (billingCountryCode) {
              const countrySelectors = [
                'select[autocomplete="country"]',
                'select[name*="country" i]',
                'select[id*="country" i]',
              ];
              for (const selector of countrySelectors) {
                const sel = await newPage.$(selector);
                if (sel) {
                  await sel
                    .selectOption({ value: String(billingCountryCode) })
                    .catch(async () => {
                      await sel.selectOption({
                        value: String(billingCountryCode).toLowerCase(),
                      });
                    })
                    .catch(() => {});
                  console.log("   ✓ Selected billing country");
                  break;
                }
              }
            }

            // DOB fill is handled via tryFillDob() above.

            // Look for "Pay at property" option
            try {
              const payAtPropertySelectors = [
                'text="Pay at property"',
                'text="Pay at the property"',
                'input[value*="pay_later"]',
                '[data-testid="pay-at-property"]',
                // pay on Date
                'span:has-text("Pay on")',
                'div:has-text("Pay on")',
                'label:has-text("Pay on")',
                'span:has-text("Pay later")',
                'div:has-text("Pay later")',
                'input[value*="pay_later"]',
              ];

              for (const selector of payAtPropertySelectors) {
                const option = await newPage.$(selector);
                if (option) {
                  await option.click();
                  console.log("   ✓ Selected: Pay at property");
                  break;
                }
              }
            } catch (e) {
              console.log('   ⚠️ "Pay at property" option not found');
            }

            console.log("   ✅ Credit card details filled - Ready to book");

            // Log validation messages but proceed anyway (these are often transient UI errors)
            if (
              paymentErrors?.some((m) =>
                /fill\s+in\s+all\s+required\s+fields/i.test(m)
              )
            ) {
              console.log(
                "   ⚠️ Page reports missing required fields, but proceeding to click anyway..."
              );
            }
            if (
              paymentErrors?.some((m) =>
                /having\s+trouble\s+loading\s+payment\s+methods|try\s+again|were\s+not\s+able\s+to\s+take\s+your\s+payment/i.test(
                  m
                )
              )
            ) {
              console.log(
                "   ⚠️ Page reports payment method loading issue, but proceeding to click anyway..."
              );
            }

            // ========== CLICK FINAL BOOKING BUTTON ==========
            if (process.env.BOOKING_CLICK_FINAL === "false") {
              console.log(
                "   ⚠️ BOOKING_CLICK_FINAL=false; skipping final booking button click"
              );
              const extra = paymentFilledScreenshotPath
                ? ` Screenshot: ${paymentFilledScreenshotPath}`
                : "";
              throw new Error(
                `DEBUG_FINAL_CLICK_SKIPPED: Final booking click skipped by env flag.${extra}`
              );
            }

            console.log("   🔘 Clicking final booking button...");

            const finalBookingSelectors = [
              'button:has-text("Complete booking")',
              'button:has-text("Confirm booking")',
              'button:has-text("Book now")',
              'button:has-text("Book with commitment to pay")',
              'button[type="submit"]:has-text("Book")',
              '[data-testid="final-booking-button"]',
              'button[name="book"]',
            ];

            let bookingClicked = false;
            for (const selector of finalBookingSelectors) {
              try {
                const finalBtn = await newPage.$(selector);
                if (finalBtn) {
                  await finalBtn.click();
                  console.log("   ✓ Clicked final booking button");
                  await newPage.waitForTimeout(8000); // Wait for processing
                  bookingClicked = true;
                  break;
                }
              } catch (e) {}
            }

            if (!bookingClicked) {
              console.log(
                "   ⚠️ Could not find final booking button, trying generic submit..."
              );
              await newPage.keyboard.press("Enter");
              await newPage.waitForTimeout(8000);
            }

            // Wait for confirmation page
            console.log(
              "   ⏳ Waiting for confirmation page (You have 120s to approve 3D Secure on phone)..."
            );
            await newPage.waitForTimeout(5000);
            try {
              await newPage.waitForSelector(
                '[data-testid="confirmation-status"], .confirmation-header, .bui-alert--success, :text("Booking confirmed")',
                { timeout: 60000 }
              );
              console.log("   ✓ Confirmation page detected!");
            } catch (e) {
              console.log(
                "   ⚠️ Timeout waiting for confirmation selector. Continuing to PNR extraction anyway..."
              );
            }

            // Take screenshot of confirmation
            const confirmPath = path.join(
              __dirname,
              "../../screenshots/booking_confirmation.png"
            );
            await newPage.screenshot({
              path: confirmPath,
              fullPage: true,
            });
            console.log("   📸 Confirmation screenshot saved");

            // Extract PNR/Booking Reference
            console.log("   🔍 Extracting booking reference/PNR...");
            const pnrExtracted = await newPage.evaluate(() => {
              const bodyText = document.body.innerText;

              // Look for common PNR patterns
              const patterns = [
                /booking\s+(?:reference|number|confirmation)[:\s]+([A-Z0-9]{6,12})/i,
                /confirmation\s+(?:code|number)[:\s]+([A-Z0-9]{6,12})/i,
                /reference[:\s]+([A-Z0-9]{6,12})/i,
                /booking\s+ID[:\s]+([A-Z0-9]{6,12})/i,
                /PNR[:\s]+([A-Z0-9]{6,10})/i,
                /([A-Z]{2}[0-9]{6,8})/,
                // Booking.com often uses long numeric booking numbers, sometimes with separators (dots/spaces)
                /booking\s+number[:\s#]+([0-9][0-9 .-]{6,})/i,
                /confirmation\s+number[:\s#]+([0-9][0-9 .-]{6,})/i,
                /reservation\s+number[:\s#]+([0-9][0-9 .-]{6,})/i,
              ];

              for (const pattern of patterns) {
                const match = bodyText.match(pattern);
                if (match && match[1]) {
                  const raw = String(match[1]).trim();
                  // Normalize numeric refs by stripping separators
                  if (/^[0-9 .-]+$/.test(raw)) {
                    const normalized = raw.replace(/[^0-9]/g, "");
                    return normalized.length >= 6 ? normalized : raw;
                  }
                  return raw;
                }
              }

              // Try to find it in specific elements
              const elements = document.querySelectorAll(
                '[data-testid*="confirmation"], [class*="confirmation"], [class*="booking-ref"], strong, b, h1, h2, h3'
              );
              for (const el of elements) {
                const text = el.textContent;
                if (/^[A-Z0-9]{6,12}$/.test(text.trim())) {
                  return text.trim();
                }
                const t = (text || "").trim();
                if (/^[0-9][0-9 .-]{6,}$/.test(t)) {
                  const normalized = t.replace(/[^0-9]/g, "");
                  if (normalized.length >= 6) return normalized;
                }
              }

              return null;
            });

            if (pnrExtracted) {
              bookingData.pnr = pnrExtracted;
              console.log(`   ✅ PNR Extracted: ${pnrExtracted}`);

              // Download official Booking.com PDF
              console.log(
                "   🖨️ Downloading official booking confirmation PDF..."
              );
              try {
                const pdfDir = path.join(__dirname, "../../downloads");
                ensureDirExists(pdfDir);
                const finalPdfPath = path.join(
                  pdfDir,
                  `Booking_${pnrExtracted}.pdf`
                );

                // First, dismiss any popups/overlays that might block clicks
                console.log("   🔄 Dismissing any popups/overlays...");
                try {
                  // Close any modal overlays
                  const closeButtonSelectors = [
                    '[aria-label="Dismiss sign-in info."]',
                    '[aria-label="Close"]',
                    'button[aria-label*="close" i]',
                    'button[aria-label*="dismiss" i]',
                    ".bui-modal__close",
                    '[data-testid="header-close-button"]',
                    '[data-testid="modal-close-button"]',
                    ".modal-close",
                    ".popup-close",
                    "button.close",
                    '[class*="close-button"]',
                    // Specific class from error log
                    ".dc7e768484 button",
                    ".bbe73dce14 button",
                  ];

                  for (const selector of closeButtonSelectors) {
                    try {
                      const closeBtn = await newPage.$(selector);
                      if (closeBtn && (await closeBtn.isVisible())) {
                        await closeBtn.click({ force: true, timeout: 2000 });
                        console.log(`   ✓ Closed popup: ${selector}`);
                        await newPage.waitForTimeout(500);
                      }
                    } catch (e) {}
                  }

                  // Click outside any modals to dismiss them
                  await newPage.mouse.click(10, 10);
                  await newPage.waitForTimeout(500);

                  // Press Escape to close any dialogs
                  await newPage.keyboard.press("Escape");
                  await newPage.waitForTimeout(500);

                  // Try to remove blocking overlay via JavaScript
                  await newPage.evaluate(() => {
                    // Remove overlay elements that might block clicks
                    const overlayClasses = [
                      "bbe73dce14",
                      "dc7e768484",
                      "modal-backdrop",
                      "overlay",
                    ];
                    overlayClasses.forEach((cls) => {
                      document.querySelectorAll(`.${cls}`).forEach((el) => {
                        el.style.display = "none";
                        el.style.pointerEvents = "none";
                      });
                    });
                    // Also hide any fixed position overlays
                    document
                      .querySelectorAll('[style*="position: fixed"]')
                      .forEach((el) => {
                        if (el.style.zIndex > 100) {
                          el.style.pointerEvents = "none";
                        }
                      });
                  });
                  await newPage.waitForTimeout(500);
                } catch (dismissError) {
                  console.log("   ℹ️ Popup dismissal attempt completed");
                }

                // Step 1: Click "Print full version" button (based on actual Booking.com UI)
                console.log('   📄 Looking for "Print full version" button...');
                const printFullVersionSelectors = [
                  'button:has-text("Print full version")',
                  'a:has-text("Print full version")',
                  'button:has-text("Print confirmation")',
                  'a:has-text("Print confirmation")',
                  '[data-testid="print-confirmation"]',
                  '[data-testid="print-button"]',
                  'button.bui-button--secondary:has-text("Print")',
                  ".print-btn",
                ];

                let printConfirmBtn = null;
                for (const selector of printFullVersionSelectors) {
                  try {
                    printConfirmBtn = await newPage.$(selector);
                    if (
                      printConfirmBtn &&
                      (await printConfirmBtn.isVisible())
                    ) {
                      console.log(`   ✓ Found button: ${selector}`);
                      break;
                    }
                  } catch (e) {}
                }

                if (printConfirmBtn) {
                  // Handle PDF generation via print page
                  // Booking.com opens a new tab for printing
                  const printPagePromise = context
                    .waitForEvent("page", { timeout: 15000 })
                    .catch(() => null);

                  // Use force: true to bypass any remaining overlays
                  try {
                    await printConfirmBtn.click({
                      force: true,
                      timeout: 10000,
                    });
                    console.log('   ✓ Clicked "Print full version" button');
                  } catch (clickErr) {
                    // Fallback: Try JavaScript click
                    console.log(
                      "   ⚠️ Normal click failed, trying JS click..."
                    );
                    await newPage.evaluate(
                      (btn) => btn.click(),
                      printConfirmBtn
                    );
                    console.log("   ✓ Clicked button via JavaScript");
                  }
                  await newPage.waitForTimeout(3000);

                  // Check if a new page opened for print preview
                  const printPage = await printPagePromise;

                  if (printPage) {
                    console.log("   ✓ Print preview page opened");
                    await printPage.waitForLoadState("domcontentloaded");
                    await printPage.waitForTimeout(2000);

                    // Generate PDF from the print page using Playwright's PDF feature
                    console.log("   📄 Generating PDF from print page...");
                    await printPage.pdf({
                      path: finalPdfPath,
                      format: "A4",
                      printBackground: true,
                      margin: {
                        top: "20px",
                        bottom: "20px",
                        left: "20px",
                        right: "20px",
                      },
                    });

                    console.log(`   ✅ PDF saved: ${finalPdfPath}`);
                    bookingData.pdfPath = finalPdfPath;

                    // Close the print page
                    await printPage.close().catch(() => {});
                  } else {
                    // No new page - try to generate PDF from current page
                    console.log(
                      "   ℹ️ No print page opened, generating PDF from current page..."
                    );
                    await newPage.pdf({
                      path: finalPdfPath,
                      format: "A4",
                      printBackground: true,
                      margin: {
                        top: "20px",
                        bottom: "20px",
                        left: "20px",
                        right: "20px",
                      },
                    });

                    console.log(
                      `   ✅ PDF saved from confirmation page: ${finalPdfPath}`
                    );
                    bookingData.pdfPath = finalPdfPath;
                  }

                  // Step 2: Send PDF to client via email using email_service
                  if (booking.email) {
                    console.log(
                      `   📧 Sending confirmation PDF to ${booking.email}...`
                    );
                    try {
                      // Dynamic import for email service
                      const { sendTicketEmail } = await import(
                        "../services/email_service.js"
                      );

                      const emailSent = await sendTicketEmail(
                        booking.email,
                        booking.clientName || "Valued Guest",
                        finalPdfPath
                      );

                      if (emailSent) {
                        console.log(
                          `   ✅ Confirmation email sent to ${booking.email}`
                        );
                        bookingData.emailSent = true;
                      } else {
                        console.log("   ⚠️ Email sending returned false");
                        bookingData.emailSent = false;
                      }
                    } catch (emailError) {
                      console.log(
                        `   ⚠️ Email sending failed: ${emailError.message}`
                      );
                      bookingData.emailSent = false;
                      bookingData.emailError = emailError.message;
                    }
                  } else {
                    console.log(
                      "   ⚠️ Client email not found, skipping email send"
                    );
                  }
                } else {
                  console.log('   ⚠️ "Print full version" button not found');

                  // Fallback: Generate PDF from confirmation page directly
                  console.log(
                    "   📄 Generating PDF from confirmation page as fallback..."
                  );
                  try {
                    await newPage.pdf({
                      path: finalPdfPath,
                      format: "A4",
                      printBackground: true,
                      margin: {
                        top: "20px",
                        bottom: "20px",
                        left: "20px",
                        right: "20px",
                      },
                    });
                    console.log(`   ✅ Fallback PDF saved: ${finalPdfPath}`);
                    bookingData.pdfPath = finalPdfPath;

                    // Send email with fallback PDF
                    if (booking.email) {
                      try {
                        const { sendTicketEmail } = await import(
                          "../services/email_service.js"
                        );
                        await sendTicketEmail(
                          booking.email,
                          booking.clientName || "Guest",
                          finalPdfPath
                        );
                        console.log(`   ✅ Email sent with fallback PDF`);
                      } catch (e) {
                        console.log(`   ⚠️ Email failed: ${e.message}`);
                      }
                    }
                  } catch (fallbackErr) {
                    console.log(
                      `   ⚠️ Fallback PDF generation failed: ${fallbackErr.message}`
                    );
                  }
                }
              } catch (pdfError) {
                console.log(`   ⚠️ PDF download failed: ${pdfError.message}`);
              }
            } else {
              console.log("   ❌ ERROR: No PNR found on confirmation page!");
              console.log("   ❌ Booking may not have completed successfully");
              throw new Error("Real PNR not found - booking incomplete");
            }
          } else {
            console.log(
              "   ⚠️ Credit card details not found in environment variables"
            );
            console.log(
              "   Please set: CARD_NUMBER, CARD_HOLDER (or CARD_HOLDER_NAME), CARD_EXP_MONTH, CARD_EXP_YEAR, CARD_CVC (or CARD_CVV)"
            );
          }
        } catch (e) {
          const firstLine = String(e?.message || "").split("\n")[0];

          if (paymentReached) {
            console.log(
              "   ⚠️ Payment step error after reaching payment page - booking not completed"
            );
            console.log("   Details:", firstLine);
            // Preserve the original error so worker logs show the real reason.
            throw e;
          }

          console.log(
            "   ⚠️ Payment page timeout - booking may not have completed"
          );
          console.log("   Details:", firstLine);
          console.log(
            "   ❌ ERROR: Booking did NOT complete - payment page not reached"
          );
          console.log(
            "   ❌ This is NOT a real booking - reverting status to Pending"
          );
          throw new Error("Payment page not reached - booking failed");
        }
      } else {
        console.log("   ⚠️ Reserve button not found, skipping payment step");
      }
    } catch (e) {
      console.log("   ⚠️ Payment processing error:", e.message);
      console.error(e.stack);
    }

    // ========== UPDATE EXISTING BOOKING (REAL MODE) ==========
    console.log("💾 Updating booking in database...");

    // Use ONLY real extracted PNR - no fake generation
    if (!bookingData.pnr) {
      throw new Error("Cannot update booking - no real PNR extracted");
    }
    const pnr = bookingData.pnr;
    const updatedBooking = await Booking.findByIdAndUpdate(
      booking._id,
      {
        $set: {
          hotelName,
          price,
          pnr,
          status: "Confirmed",
          platform: "Booking.com",
          pdfPath: bookingData.pdfPath || null,
          freeCancellationDeadline:
            bookingData.freeCancellationDeadline || null,
        },
      },
      { new: true }
    );

    console.log("✅ Booking confirmed in DB!");
    console.log(`   📋 Booking ID: ${updatedBooking._id}`);
    console.log(`   🔖 PNR: ${pnr}`);
    console.log(`   🏨 Hotel: ${hotelName}`);
    console.log(`   💰 Price: ${price}`);
    console.log(`   📍 Address: ${address}`);
    console.log(`   ✅ STATUS: Confirmed - Real booking completed`);

    // ========== FINALIZE ==========
    const screenshotPath = path.join(
      __dirname,
      "../../screenshots/booking_success.png"
    );
    await newPage.screenshot({ path: screenshotPath });
    console.log(`📸 Screenshot saved: screenshots/booking_success.png`);

    // Close browser
    console.log("🔒 Closing browser...");
    await browser.close();

    console.log("═".repeat(60));
    console.log("✅ BOOKING ENGINE COMPLETED SUCCESSFULLY");
    console.log(
      "🎫 Real booking confirmed - Customer will receive email with PNR"
    );
    console.log("═".repeat(60));

    return updatedBooking;
  } catch (error) {
    console.error("❌ Booking Engine Error:", error.message);

    // Cleanup on error
    if (browser) {
      await browser.close();
    }

    throw error;
  }
}

export { searchAndBookHotel, connectDB, disconnectDB };
