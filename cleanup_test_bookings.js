import "dotenv/config";
import mongoose from "mongoose";
import Booking from "./src/models/Booking.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/travel_automation";

async function cleanupTestBookings() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected successfully");

    // Keep only the real booking with PNR 5845279780
    const realPNR = "5845279780";

    console.log("\n📊 Current bookings in database:");
    const allBookings = await Booking.find({});
    console.log(`   Total bookings: ${allBookings.length}`);

    for (const booking of allBookings) {
      console.log(
        `   - ID: ${booking._id}, PNR: ${booking.pnr || "N/A"}, Status: ${
          booking.status
        }, Client: ${booking.clientName}`
      );
    }

    // Delete all bookings except the real one
    console.log(
      `\n🗑️  Deleting all test bookings (keeping PNR: ${realPNR})...`
    );
    const result = await Booking.deleteMany({
      $or: [
        { pnr: { $ne: realPNR } },
        { pnr: { $exists: false } },
        { pnr: null },
      ],
    });

    console.log(`   ✓ Deleted ${result.deletedCount} test booking(s)`);

    console.log("\n📊 Remaining bookings:");
    const remainingBookings = await Booking.find({});
    console.log(`   Total bookings: ${remainingBookings.length}`);

    for (const booking of remainingBookings) {
      console.log(`   ✅ PNR: ${booking.pnr}`);
      console.log(`      Client: ${booking.clientName}`);
      console.log(`      Hotel: ${booking.hotelName}`);
      console.log(`      Price: $${booking.price}`);
      console.log(`      Status: ${booking.status}`);
      console.log(`      Check-in: ${booking.checkInDate}`);
      console.log(`      Check-out: ${booking.checkOutDate}`);
    }

    console.log("\n✅ Database cleanup completed!");

    await mongoose.disconnect();
    console.log("📤 MongoDB disconnected");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

cleanupTestBookings();
