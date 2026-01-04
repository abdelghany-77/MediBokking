import "dotenv/config";
import mongoose from "mongoose";
import Booking from "./models/Booking.js";
import { searchAndBookHotel } from "./automation/booking_engine.js";
import { automateNouvelairBooking as reserveFlight } from "./automation/nouvelair_engine.js";
import { generateAllPassengerPDFs } from "./services/pdf_generator.js";
import {
  sendTicketEmail,
  sendFlightConfirmationEmail,
} from "./services/email_service.js";

// MongoDB Connection URI
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/travel_automation";

// Worker configuration
const POLL_INTERVAL = 10000;

// Track the booking currently being processed so we can safely revert it on shutdown.
let activeBookingId = null;

/**
 * Connect to MongoDB
 */
async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return;
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
 * Process a single pending booking
 */
async function processPendingBookings() {
  try {
    const forcedId = process.env.WORKER_BOOKING_ID;

    // Find ONE valid booking with status 'Pending'
    const booking = forcedId
      ? await Booking.findOne({ _id: forcedId })
      : await Booking.findOne({
          status: "Pending",
          pnr: { $in: [null, "", undefined] },
          $or: [
            {
              serviceType: "Hotel",
              destination: { $exists: true, $ne: "" },
              checkInDate: { $ne: null },
              checkOutDate: { $ne: null },
            },
            {
              serviceType: "Flight",
              departureAirport: { $exists: true, $ne: "" },
              arrivalAirport: { $exists: true, $ne: "" },
              flightDate: { $ne: null },
            },
          ],
        }).sort({ createdAt: 1 });

    if (!booking) {
      if (forcedId) {
        console.log(`💤 No booking found for WORKER_BOOKING_ID=${forcedId}`);
      } else {
        console.log("💤 No pending bookings... waiting...");
      }
      return;
    }

    console.log("═".repeat(60));
    console.log(`🔄 Processing booking for ${booking.clientName}...`);
    console.log(`📋 Booking ID: ${booking._id}`);
    console.log("═".repeat(60));

    // Update status to 'Processing'
    booking.status = "Processing";
    await booking.save();
    activeBookingId = booking._id;
    console.log("   ✓ Status updated to: Processing");

    try {
      let updatedBooking = booking;

      // ====================================================
      // STEP 1: Process based on service type
      // ====================================================
      if (booking.serviceType === "Flight") {
        console.log("\n📌 Step 1: Processing Flight Booking...");
        console.log("   ✈️ Flight automation started...");

        const flightData = await reserveFlight(booking);

        booking.pnr = flightData.pnr;

        // Store travel date as proper Date if available
        if (booking.flightDate) {
          try {
            booking.checkInDate = new Date(booking.flightDate);
          } catch (e) {}
        }

        // Robustly handle price: flightData.price may be number or string
        if (flightData.price !== undefined && flightData.price !== null) {
          let numericPrice = 0;
          if (typeof flightData.price === "number") {
            numericPrice = flightData.price;
          } else {
            let s = String(flightData.price || "").trim();
            // Normalize spaces and NBSP between digit groups ("1 154")
            s = s.replace(/\u00A0/g, " ");
            while (/\d+\s+\d{3}/.test(s)) {
              s = s.replace(/(\d)\s+(\d{3})/g, "$1$2");
            }
            // extract tokens like 1.234,56 or 1234.56 or 1,234
            const tokens = (s.match(/[\d.,]+/g) || [])
              .map((t) => t.trim())
              .filter(Boolean);
            const candidates = [];
            tokens.forEach((token) => {
              if (token.includes(".") && token.includes(",")) {
                const v = parseFloat(
                  token.replace(/\./g, "").replace(/,/g, ".")
                );
                if (isFinite(v)) candidates.push(v);
              } else if (token.includes(",") && !token.includes(".")) {
                const parts = token.split(",");
                const last = parts[parts.length - 1] || "";
                if (last.length === 2) {
                  const v = parseFloat(
                    token.replace(/\./g, "").replace(/,/g, ".")
                  );
                  if (isFinite(v)) candidates.push(v);
                } else {
                  const v = parseFloat(token.replace(/,/g, ""));
                  if (isFinite(v)) candidates.push(v);
                }
              } else if (token.includes(".") && !token.includes(",")) {
                const parts = token.split(".");
                const last = parts[parts.length - 1] || "";
                if (last.length === 2) {
                  const v = parseFloat(token.replace(/,/g, ""));
                  if (isFinite(v)) candidates.push(v);
                } else {
                  const v = parseFloat(token.replace(/\./g, ""));
                  if (isFinite(v)) candidates.push(v);
                }
              } else {
                const v = parseFloat(token);
                if (isFinite(v)) candidates.push(v);
              }
            });

            const plausible = candidates.filter((v) => v > 0 && v < 1000000);
            if (plausible.length)
              numericPrice = plausible[plausible.length - 1];
            else if (tokens.length === 1)
              numericPrice = parseFloat(tokens[0].replace(/,/g, "")) || 0;
          }

          if (numericPrice && isFinite(numericPrice))
            booking.price = numericPrice;
        }

        // Save screenshot path if automation returned one
        if (flightData.screenshot)
          booking.screenshotPath = flightData.screenshot;

        booking.flightNumber = flightData.flightNumber;
        booking.platform = flightData.carrier || "Nouvelair";

        booking.status = "Confirmed";

        await booking.save();
        updatedBooking = booking;

        console.log("   ✓ Flight reserved & DB updated (Confirmed)");
        console.log(`   🔖 PNR: ${booking.pnr}`);
        console.log(`   💰 Price: ${booking.price}`);
      } else {
        // Hotel booking logic
        console.log("\n📌 Step 1: Processing Hotel Booking...");
        console.log("   🏨 Hotel automation started...");

        updatedBooking = await searchAndBookHotel(booking);
        console.log("   ✓ Hotel booked successfully");
      }

      // ====================================================
      // STEP 2: Email Notification
      // ====================================================
      console.log("\n📌 Step 2: Preparing Email...");

      // Flight automation currently returns a screenshot, not a PDF
      // We will try to send email if PDF exists, otherwise just log it
      let pdfPath = updatedBooking.pdfPath || null;

      if (booking.serviceType === "Flight") {
        // Generate PDF tickets for each passenger
        console.log("\n📌 Step 3: Generating PDF tickets...");
        try {
          const pdfPaths = await generateAllPassengerPDFs(updatedBooking);

          if (pdfPaths.length > 0) {
            // Store first PDF path in booking record
            updatedBooking.pdfPath = pdfPaths[0];
            await updatedBooking.save();

            // Send email with all PDF attachments
            console.log("\n📌 Step 4: Sending confirmation email...");
            const emailSent = await sendFlightConfirmationEmail(
              updatedBooking,
              pdfPaths
            );
            if (emailSent) {
              console.log(
                "   ✓ Email sent successfully with",
                pdfPaths.length,
                "PDF(s)"
              );
            } else {
              console.log("   ⚠️ Email sending failed (non-critical)");
            }
          } else {
            console.log("   ⚠️ No PDFs generated");
          }
        } catch (pdfError) {
          console.error(
            "   ⚠️ PDF/Email error (non-critical):",
            pdfError.message
          );
        }
      } else if (pdfPath) {
        console.log("\n📌 Step 3: Sending confirmation email...");
        const emailSent = await sendTicketEmail(
          updatedBooking.email,
          updatedBooking.clientName,
          pdfPath
        );
        if (emailSent) console.log("   ✓ Email sent successfully");
        else console.log("   ⚠️ Email sending failed (non-critical)");
      }

      // Final Confirmation Save
      if (updatedBooking.status !== "Confirmed") {
        updatedBooking.status = "Confirmed";
        await updatedBooking.save();
      }

      console.log("\n" + "═".repeat(60));
      console.log(`✅ CYCLE COMPLETE for Booking ID: ${updatedBooking._id}`);
      console.log(`   👤 Client: ${updatedBooking.clientName}`);
      console.log(`   🔖 PNR: ${updatedBooking.pnr}`);
      console.log("═".repeat(60) + "\n");
    } catch (processingError) {
      // Log full error server-side (for debugging)
      console.error("❌ Error processing booking:", processingError);

      // Sanitize what we store in the booking record so frontend doesn't receive raw
      // stack traces or internal details. Keep server logs with full details above.
      function sanitizeErrorMessage(err) {
        if (!err)
          return "An unknown error occurred while processing the booking.";
        let msg = String(err.message || err || "");

        // Remove verbose call logs or Playwright call details
        msg = msg.replace(/Call log:[\s\S]*/i, "");
        msg = msg.replace(/\[.*?m - navigating to[\s\S]*/i, "");

        // Map some known noisy errors to friendly messages
        if (msg.includes("ERR_INVALID_ARGUMENT"))
          return "External site navigation failed.";
        if (msg.includes("Navigation timeout") || msg.includes("Timeout"))
          return "External site took too long to respond.";
        if (msg.includes("No hotels found"))
          return "No options found matching the criteria.";
        if (
          msg.includes("ERR_CERT_AUTHORITY_INVALID") ||
          msg.includes("CERT_AUTHORITY")
        )
          return "External site certificate error.";

        // Strip URLs and stack trace lines to avoid exposing internals
        msg = msg.replace(/https?:\/\/\S+/gi, "");
        msg = msg
          .split(/\r?\n/)
          .filter((ln) => !ln.trim().startsWith("at ") && !/^\s*\^/.test(ln))
          .join(" ")
          .trim();

        // Collapse whitespace
        msg = msg.replace(/\s+/g, " ").trim();

        if (!msg) return "An error occurred while processing the booking.";

        // Truncate long messages and avoid exposing internals
        return msg.length > 200 ? msg.slice(0, 197) + "..." : msg;
      }

      booking.errorMessage = sanitizeErrorMessage(processingError);

      // CRITICAL: If booking already has a PNR, keep it Confirmed
      if (booking.pnr && String(booking.pnr).trim().length > 0) {
        booking.status = "Confirmed";
        console.log("   ✅ Booking has PNR - kept as Confirmed despite error.");
      } else if (processingError.message.includes("No hotels found")) {
        booking.status = "Failed";
      } else {
        // Retry logic
        booking.attempts = (booking.attempts || 0) + 1;
        const maxAttempts = parseInt(process.env.BOOKING_MAX_ATTEMPTS || "1");

        if (booking.attempts <= maxAttempts) {
          booking.status = "Pending";
          console.log(`   ↩️ Reverting to Pending (retry ${booking.attempts})`);
        } else {
          booking.status = "Failed";
          console.log(`   ⚠️ Status set to: Failed`);
        }
      }

      await booking.save();
    }

    activeBookingId = null;
  } catch (error) {
    console.error("❌ Worker error:", error.message);
  }
}

/**
 * Start the worker loop
 */
async function startWorker() {
  console.log("═".repeat(60));
  console.log("🤖 TRAVEL AUTOMATION WORKER");
  console.log("═".repeat(60));
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL / 1000} seconds`);
  console.log("═".repeat(60));
  console.log("");

  await connectDB();
  await processPendingBookings();

  if (process.env.WORKER_RUN_ONCE === "true") {
    await mongoose.disconnect();
    process.exit(0);
  }

  setInterval(async () => {
    await processPendingBookings();
  }, POLL_INTERVAL);
}

// Handle graceful shutdown
const shutdown = async (signal) => {
  try {
    console.log(`\n🛑 Shutting down worker (${signal})...`);
    if (activeBookingId) {
      try {
        await Booking.findByIdAndUpdate(activeBookingId, {
          $set: { status: "Pending" },
        });
        console.log(`↩️ Reverted active booking to Pending`);
      } catch (e) {
        console.log(`⚠️ Could not revert booking: ${e.message}`);
      }
    }
    await mongoose.disconnect();
    console.log("📤 MongoDB disconnected");
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startWorker().catch((err) => {
  console.error("❌ Worker startup failed:", err.message);
  process.exit(1);
});
