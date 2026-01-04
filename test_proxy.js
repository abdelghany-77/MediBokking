import { chromium } from "playwright";

// بياناتك من BrightData
const PROXY_CONFIG = {
  server: "http://brd.superproxy.io:33335",
  username: "brd-customer-hl_551e92f2-zone-residential_proxy1",
  password: "0p65a85vctvf",
};

(async () => {
  console.log("🔵 Starting BrightData Proxy Test (FIXED)...");
  console.log(`📡 Proxy Server: ${PROXY_CONFIG.server}`);
  console.log(`👤 Username: ${PROXY_CONFIG.username}`);
  console.log(`🔑 Password: ******\n`);

  let browser;
  try {
    // ✅ الطريقة الصحيحة في Playwright
    browser = await chromium.launch({
      headless: true,
      proxy: {
        server: PROXY_CONFIG.server, // ✅ فقط السيرفر
        username: PROXY_CONFIG.username, // ✅ منفصل
        password: PROXY_CONFIG.password, // ✅ منفصل
      },
      args: [
        "--ignore-certificate-errors",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const page = await browser.newPage();

    console.log("🌍 Navigating to BrightData Geo-Check...");

    const response = await page.goto("https://geo.brdtest.com/mygeo.json", {
      timeout: 60000,
      waitUntil: "domcontentloaded",
    });

    const status = response.status();
    console.log(`📊 HTTP Status: ${status}`);

    if (status !== 200) {
      throw new Error(`Server returned status ${status}`);
    }

    const content = await page.textContent("body");
    const json = JSON.parse(content);

    console.log("\n═══════════════════════════════════════════════");
    console.log("✅ PROXY TEST PASSED!");
    console.log("═══════════════════════════════════════════════");
    console.log(`🌍 IP Address:    ${json.ip}`);
    console.log(`🏳️  Country:       ${json.country}`);
    console.log(`📍 City:          ${json.geo?.city || "N/A"}`);
    console.log(`🏢 ASN:           ${json.asn?.org_name || json.asn?.asnum}`);
    console.log(`⏰ Timezone:      ${json.geo?.tz || "N/A"}`);
    console.log("═══════════════════════════════════════════════\n");

    // Test with real website
    console.log("🧪 Testing with real website (whatismyipaddress.com)...");
    await page.goto("https://whatismyipaddress.com/", { timeout: 30000 });
    await page.waitForTimeout(3000);

    const title = await page.title();
    console.log(`✅ Page loaded successfully: ${title}`);
  } catch (error) {
    console.error("\n═══════════════════════════════════════════════");
    console.error("❌ PROXY TEST FAILED");
    console.error("═══════════════════════════════════════════════");
    console.error(`Error: ${error.message}\n`);

    if (error.message.includes("407")) {
      console.log("🔧 TROUBLESHOOTING STEPS:");
      console.log("1. Check BrightData Dashboard → Zone Settings");
      console.log("2. Verify 'IP Whitelist' includes your server IP");
      console.log("3. Make sure credentials are correct");
      console.log("4. Try regenerating zone password\n");
    } else if (error.message.includes("timeout")) {
      console.log("🔧 TROUBLESHOOTING STEPS:");
      console.log("1. Check your internet connection");
      console.log("2. Verify proxy server is accessible");
      console.log("3. Try increasing timeout value\n");
    }
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Browser closed.");
    }
  }
})();
