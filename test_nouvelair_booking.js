import { automateNouvelairBooking } from "./src/automation/nouvelair_engine.js";
import mongoose from "mongoose";

// ==================================================================
// VALID ROUND TRIP CASE (MATCHING YOUR SCREENSHOT)
// ==================================================================
const validRoundTrip = {
  _id: new mongoose.Types.ObjectId(),
  serviceType: "Flight",
  platform: "Nouvelair",

  clientName: "Mehdi Jedir",
  email: "elamana.ecole@gmail.com",
  phone: "50689836",
  country: "Tunisia",
  passportNumber: "Z12345678",
  passengerDOB: new Date("1990-01-01"),

  departureAirport: "TUN",
  arrivalAirport: "BOD",

  flightDate: new Date("2026-03-31"),
  returnDate: new Date("2026-04-03"),

  status: "Pending",
};

// ==================================================================
// TWO PASSENGERS ROUND TRIP TEST
// ==================================================================
const twoPassengersTrip = {
  _id: new mongoose.Types.ObjectId(),
  serviceType: "Flight",
  platform: "Nouvelair",

  clientName: "Mehdi Jedir",
  email: "elamana.ecole@gmail.com",
  phone: "50689836",
  country: "Tunisia",

  departureAirport: "TUN",
  arrivalAirport: "BOD",

  flightDate: new Date("2026-03-31"),
  returnDate: new Date("2026-04-03"),

  // Multiple passengers
  adults: 2,
  children: 0,
  infants: 0,
  passengersList: [
    {
      clientName: "Mehdi Jedir",
      nationality: "Tunisia",
      title: "Mr.",
    },
    {
      clientName: "Ahmed Ben Ali",
      nationality: "Tunisia",
      title: "Mr.",
    },
  ],

  status: "Pending",
};

// ==================================================================
// LIST OF TEST CASES
// ==================================================================
const testCases = [
  {
    name: "Valid Round Trip (TUN <-> BOD) [31 Mar - 03 Apr]",
    data: validRoundTrip,
  },
  {
    name: "Two Passengers Round Trip (TUN <-> BOD) [31 Mar - 03 Apr]",
    data: twoPassengersTrip,
  },
];

// ==================================================================
// TEST RUNNER
// ==================================================================
async function runTest(booking, testName) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TEST: ${testName}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    const result = await automateNouvelairBooking(booking);

    console.log("\n✅ TEST PASSED");
    console.log(`\n📋 RESULTS:`);
    console.log(`   PNR: ${result.pnr}`);
    console.log(`   Total Price: ${result.price}`);
    console.log(`   Screenshot: ${result.screenshotPath}`);

    return { success: true, result };
  } catch (error) {
    console.error("\n❌ TEST FAILED");
    console.error(`   Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// CLI Execution Logic
const args = process.argv.slice(2);
const testNum = parseInt(args[0]) || 1; // Default to test case 1

if (testNum >= 1 && testNum <= testCases.length) {
  const test = testCases[testNum - 1];
  runTest(test.data, test.name);
} else {
  console.log("\n📚 NOUVELAIR BOOKING TEST\n");
  testCases.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
}

export { testCases, runTest };
