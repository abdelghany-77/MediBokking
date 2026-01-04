import { chromium } from 'playwright';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

(async () => {
  let browser;
  try {
    console.log('🚀 Starting Robust Login Sequence...');
    
    const email = 'elamana.ecole@gmail.com'; 
    console.log(`📧 Using email: ${email}`);

    browser = await chromium.launch({
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US'
    });

    const page = await context.newPage();

    console.log('🌍 Going to Booking.com sign-in page...');
    await page.goto('https://account.booking.com/sign-in', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log('✍️ Entering email...');
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });
    await page.fill('input[name="username"]', email);
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for OTP code page...');
    await page.waitForTimeout(5000); 

    await page.screenshot({ path: 'screenshots/login_step1.png' });
    console.log('📸 Screenshot saved: screenshots/login_step1.png');

    const code = await askQuestion('\n⚠️  PLEASE ENTER THE CODE SENT TO EMAIL: ');
    console.log(`\n⌨️ Typing code: ${code}...`);

    try {
      console.log('🔎 Looking for code input field...');
      
      const otpSelectors = [
        'input[autocomplete="one-time-code"]',
        'input[name="code"]', 
        'input[name="pin"]',
        'input[type="tel"]',
        'input[inputmode="numeric"]',
        'input[data-testid="otp-input"]'
      ];
      
      let otpInput = null;
      for (const selector of otpSelectors) {
        otpInput = await page.$(selector);
        if (otpInput) {
          console.log(`✅ Found OTP input with selector: ${selector}`);
          break;
        }
      }
      
      if (otpInput) {
        // Click and focus the input field
        await otpInput.click();
        await page.waitForTimeout(500);
        
        // Clear any existing value and type the code
        await otpInput.fill('');
        await otpInput.type(code.trim(), { delay: 150 });
        console.log('✅ Code entered successfully');
        
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/code_entered.png' });
        console.log('📸 Screenshot saved: screenshots/code_entered.png');
        
        // Try to find and click submit button
        const submitSelectors = [
          'button[type="submit"]',
          'button:has-text("Continue")',
          'button:has-text("Verify")',
          'button:has-text("Sign in")'
        ];
        
        for (const selector of submitSelectors) {
          const submitBtn = await page.$(selector);
          if (submitBtn) {
            console.log('🖱️ Clicking submit button...');
            await submitBtn.click();
            break;
          }
        }
      } else {
        // Fallback: just type the code using keyboard
        console.log('⚠️ Using keyboard fallback for code entry...');
        await page.keyboard.type(code.trim(), { delay: 150 });
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
      }

    } catch (err) {
      console.log('❌ Error finding code input field:', err.message);
      await page.screenshot({ path: 'screenshots/error_code.png' });
      throw err;
    }

    console.log('⏳ Verifying login success (Navigating to Settings)...');
    
    await page.waitForTimeout(5000);
    await page.goto('https://www.booking.com/mysettings.html', { waitUntil: 'domcontentloaded' });

    try {
        await page.waitForSelector('.bui-avatar-block, button[aria-label="Your profile"], a[data-testid="header-profile"]', { timeout: 20000 });
        console.log('✅ Fully logged in! Profile detected.');
        
        console.log('💾 Saving session state to "auth.json"...');
        await context.storageState({ path: 'auth.json' });
        
        await page.screenshot({ path: 'screenshots/login_success_verified.png' });
        console.log('✅ SUCCESS! Session saved correctly.');

    } catch (e) {
        console.log('⚠️ Warning: Could not verify login on Settings page. Taking screenshot...');
        await page.screenshot({ path: 'screenshots/login_verification_failed.png' });
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  } finally {
    rl.close();
    if (browser) {
      await browser.close();
    }
  }
})();