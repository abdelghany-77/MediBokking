import { existsSync, readFileSync, writeFileSync } from "fs";

// Input and Output filenames
const INPUT_FILE = "cookies_raw 2.json";
const OUTPUT_FILE = "auth 2.json";

try {
  // 1. Check if input file exists
  if (!existsSync(INPUT_FILE)) {
    console.error(`❌ Error: File '${INPUT_FILE}' not found.`);
    console.log(
      `👉 Please create '${INPUT_FILE}' and paste your cookie array inside it.`
    );
    process.exit(1);
  }

  // 2. Read and parse the raw JSON
  const rawData = readFileSync(INPUT_FILE, "utf8");
  let rawCookies;
  try {
    rawCookies = JSON.parse(rawData);
  } catch (e) {
    console.error("❌ Error parsing JSON. Check your raw_cookies.json syntax.");
    process.exit(1);
  }

  // 3. Convert each cookie to Playwright format
  const convertedCookies = rawCookies.map((cookie) => {
    // Fix 'sameSite' values (Playwright requires specific capitalization)
    let sameSiteVal = "Lax"; // Default fallback

    if (cookie.sameSite === "no_restriction" || cookie.sameSite === "None") {
      sameSiteVal = "None";
    } else if (cookie.sameSite === "lax" || cookie.sameSite === "Lax") {
      sameSiteVal = "Lax";
    } else if (cookie.sameSite === "strict" || cookie.sameSite === "Strict") {
      sameSiteVal = "Strict";
    }
    // If sameSite was null, it defaults to 'Lax' above

    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      // Playwright expects 'expires', Cookie Editor gives 'expirationDate'
      expires: cookie.expirationDate || cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: sameSiteVal,
    };
  });

  // 4. Wrap in the StorageState structure
  const storageState = {
    cookies: convertedCookies,
    origins: [],
  };

  // 5. Save the new file
  writeFileSync(OUTPUT_FILE, JSON.stringify(storageState, null, 2));

  console.log(`✅ Conversion Successful!`);
  console.log(`📂 Output saved to: ${OUTPUT_FILE}`);
  console.log(`🍪 Converted ${convertedCookies.length} cookies.`);
} catch (error) {
  console.error("❌ Unexpected Error:", error.message);
}
