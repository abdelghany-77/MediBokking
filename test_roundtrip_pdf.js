/**
 * Test script for Round Trip Flight PDF generation
 */

import { generateFlightTicketPDF } from "./src/services/pdf_generator.js";

// Example round trip booking
const testBooking = {
  id: 1,
  pnr: "ABC123",
  serviceType: "Flight",
  clientName: "JOHN DOE",
  email: "john.doe@example.com",
  phone: "+216 50 123 456",
  country: "Tunisia",
  passportNumber: "AB1234567",
  passengerDOB: "1990-05-15",
  departureAirport: "TUN",
  arrivalAirport: "BOD",
  flightDate: "2026-01-15",
  returnDate: "2026-01-22", // This makes it a round trip!
  flightNumber: "BJ 712",
  status: "confirmed",
};

const testPassenger = {
  clientName: "JOHN DOE",
  title: "MR",
  passportNumber: "AB1234567",
  passengerDOB: "1990-05-15",
};

console.log("=================================================");
console.log("   ROUND TRIP FLIGHT PDF GENERATION TEST");
console.log("=================================================\n");

console.log("📋 Booking Details:");
console.log(`   - PNR: ${testBooking.pnr}`);
console.log(`   - Passenger: ${testBooking.clientName}`);
console.log(
  `   - Route: ${testBooking.departureAirport} → ${testBooking.arrivalAirport}`
);
console.log(`   - Outbound: ${testBooking.flightDate}`);
console.log(`   - Return: ${testBooking.returnDate}`);
console.log(`   - Flight: ${testBooking.flightNumber}\n`);

try {
  const pdfPath = await generateFlightTicketPDF(testBooking, testPassenger, 1);
  console.log("\n✅ SUCCESS! Round Trip PDF generated:");
  console.log(`   📄 ${pdfPath}\n`);
  console.log("=================================================");
} catch (error) {
  console.error("\n❌ ERROR:", error.message);
  console.error(error.stack);
}
