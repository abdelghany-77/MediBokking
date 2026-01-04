import "dotenv/config";

import { connectDB, disconnectDB } from "./config/db.js";

/**
 * Main entry point for the Travel Automation System
 */
async function main() {
  console.log(" Travel Automation System Starting...");
  console.log("━".repeat(50));

  // Connect to MongoDB
  await connectDB();

  console.log("━".repeat(50));
  console.log(" System started. Waiting for scheduler...");
  console.log("");
  console.log(" Available modules:");
  console.log("   - Booking Engine: src/automation/booking_engine.js");
  console.log("   - Flight Engine: src/automation/nouvelair_engine.js");
  console.log("   - PDF Generator: src/services/pdf_generator.js");
  console.log("   - Scheduler: src/services/scheduler.js");
  console.log("");

  // Example usage (uncomment to test):
  // const bookingEngine = require('./automation/booking_engine');
  // await bookingEngine.searchAndBookHotel('Paris', '2025-01-15', '2025-01-18');

  // Keep process alive for scheduler
  // The scheduler (when implemented) will run cron jobs
}

// Handle shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await disconnectDB();
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  console.error(" Unhandled Rejection:", err.message);
});

// Run main
main().catch((err) => {
  console.error(" Fatal error:", err.message);
  process.exit(1);
});
