import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Booking from "./models/Booking.js";
import { cancelBookingReal } from "./automation/cancellation_engine.js";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/travel_automation";

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

// ========== DATABASE CONNECTION ==========
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected successfully");
    console.log(`📦 Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1);
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

function isAuthenticated(req, res, next) {
  if (req.session.isLoggedIn) {
    return next();
  }
  res.redirect("/login.html");
}

// initScheduler();
app.get("/login.html", (req, res) => {
  if (req.session.isLoggedIn) return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isLoggedIn = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login.html");
});
// ========== API ROUTES ==========
app.get("/admin", isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});
// ➤ ADMIN API: Run Cancellation
app.post("/api/admin/cancel/:id", isAuthenticated, async (req, res) => {
  try {
    const bookingId = req.params.id;
    console.log(`Received request to cancel booking: ${bookingId}`);
    const result = await cancelBookingReal(bookingId);
    if (result.success) {
      res.json({
        success: true,
        message: "Booking cancelled on Booking.com & DB updated.",
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ➤ ADMIN API: Delete booking from DB
app.post("/api/admin/delete/:id", isAuthenticated, async (req, res) => {
  try {
    const bookingId = req.params.id;
    console.log(`Received request to delete booking: ${bookingId}`);
    const deleted = await Booking.findByIdAndDelete(bookingId);
    if (!deleted)
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    res.json({ success: true, message: "Booking deleted" });
  } catch (error) {
    console.error("API Delete Error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ➤ ADMIN API: Resend PDF confirmation email
app.post("/api/admin/resend-pdf/:id", isAuthenticated, async (req, res) => {
  try {
    const bookingId = req.params.id;
    console.log(`Received request to resend PDF for booking: ${bookingId}`);

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    if (booking.status !== "Confirmed") {
      return res.status(400).json({
        success: false,
        message: "Can only resend PDF for confirmed bookings",
      });
    }

    if (!booking.pnr) {
      return res.status(400).json({
        success: false,
        message: "No PNR available for this booking",
      });
    }

    if (!booking.email) {
      return res.status(400).json({
        success: false,
        message: "No email address for this booking",
      });
    }

    // Check if we already have the PDF file
    const pdfPath = booking.pdfPath || `./downloads/Booking_${booking.pnr}.pdf`;
    const fsModule = await import("fs");
    const pathModule = await import("path");
    const fs = fsModule.default || fsModule;
    const pathLib = pathModule.default || pathModule;

    if (fs.existsSync(pdfPath)) {
      // PDF exists, just resend the email
      console.log(`   📄 Using existing PDF: ${pdfPath}`);
      const { sendTicketEmail } = await import("./services/email_service.js");
      const emailSent = await sendTicketEmail(
        booking.email,
        booking.clientName || "Valued Guest",
        pdfPath
      );

      if (emailSent) {
        return res.json({
          success: true,
          message: "PDF email resent successfully",
        });
      } else {
        return res
          .status(500)
          .json({ success: false, message: "Failed to send email" });
      }
    } else {
      // Need to download PDF first - run the download script
      console.log(`   📄 PDF not found, downloading from Booking.com...`);

      // Use child_process to run the download script
      const { exec } = await import("child_process");
      const scriptPath = pathLib.join(process.cwd(), "download_booking_pdf.js");

      exec(
        `node "${scriptPath}" "${booking.pnr}" "${booking.email}"`,
        { cwd: process.cwd(), timeout: 120000 },
        (error, stdout, stderr) => {
          if (error) {
            console.error("   ❌ PDF download failed:", error.message);
            console.error("   STDOUT:", stdout);
            console.error("   STDERR:", stderr);
            return res.status(500).json({
              success: false,
              message: "Failed to download/send PDF",
              error: error.message,
            });
          }

          console.log("   ✅ PDF download and email completed");
          console.log(stdout);
          res.json({
            success: true,
            message: "PDF downloaded and sent successfully",
          });
        }
      );
    }
  } catch (error) {
    console.error("API Resend PDF Error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ➤ API: Get All Bookings (For Admin Panel)
app.get("/api/admin/bookings", isAuthenticated, async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});
/**
 * POST /api/submit-booking
 * Receives booking form data and saves to database
 * For group flight bookings, splits into individual records
 */
app.post("/api/submit-booking", async (req, res) => {
  try {
    const {
      serviceType,
      clientName,
      email,
      phone,
      country,
      passportNumber,
      passengerDOB,
      destination,
      checkInDate,
      checkOutDate,
      adultsCount,
      minPrice,
      maxPrice,
      departureAirport,
      arrivalAirport,
      flightDate,
      returnDate,
      passengersList,
    } = req.body;

    // Validate required fields based on service type
    if (!clientName || !email) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: clientName, email",
      });
    }

    // Validate service-specific fields
    if (serviceType === "Flight") {
      if (!departureAirport || !arrivalAirport || !flightDate) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required flight fields: departureAirport, arrivalAirport, flightDate",
        });
      }

      // GROUP FLIGHT BOOKING - Split into individual records
      console.log("🔍 Checking for group booking...");
      console.log(`   passengersList exists: ${!!passengersList}`);
      console.log(`   passengersList type: ${typeof passengersList}`);
      console.log(
        `   passengersList length: ${
          passengersList ? passengersList.length : "N/A"
        }`
      );

      if (
        passengersList &&
        Array.isArray(passengersList) &&
        passengersList.length > 0
      ) {
        console.log(
          `✅ GROUP FLIGHT BOOKING - ${passengersList.length} passengers in ONE booking`
        );

        // Create SINGLE booking with all passengers
        const booking = new Booking({
          serviceType: "Flight",

          // Use first passenger as main contact
          clientName: passengersList[0].clientName || clientName,
          passportNumber: passengersList[0].passportNumber || passportNumber,
          passengerDOB: passengersList[0].passengerDOB
            ? new Date(passengersList[0].passengerDOB)
            : undefined,

          // Store ALL passengers in the list
          passengersList: passengersList.map((p) => ({
            clientName: p.clientName,
            passportNumber: p.passportNumber,
            passengerDOB: p.passengerDOB ? new Date(p.passengerDOB) : undefined,
            nationality: p.nationality,
            title: p.title,
          })),

          // Passenger counts for selection
          adults: req.body.adults || passengersList.length,
          children: req.body.children || 0,
          infants: req.body.infants || 0,

          // Contact info
          email,
          phone,
          country,

          // Flight details
          departureAirport,
          arrivalAirport,
          flightDate: new Date(flightDate),
          returnDate: returnDate ? new Date(returnDate) : undefined,

          platform: "Nouvelair",
          status: "Pending",
        });

        await booking.save();

        console.log(`📝 Group flight booking created: ${booking._id}`);
        console.log(`   Total Passengers: ${passengersList.length}`);
        passengersList.forEach((p, i) => {
          console.log(`   - Passenger ${i + 1}: ${p.clientName}`);
        });
        console.log(`   Route: ${departureAirport} → ${arrivalAirport}`);

        return res.status(201).json({
          success: true,
          message: `Successfully created booking for ${passengersList.length} passengers`,
          bookingId: booking._id,
        });
      }
    } else {
      // Hotel validation
      if (!checkInDate || !checkOutDate || !minPrice || !maxPrice) {
        return res.status(400).json({
          success: false,
          message:
            "Missing required hotel fields: checkInDate, checkOutDate, minPrice, maxPrice",
        });
      }
    }

    // (auto-cancellation removed)

    // Create single booking (hotel or single-passenger flight)
    const booking = new Booking({
      serviceType: serviceType || "Hotel",
      clientName,
      email,
      phone,
      country,
      passportNumber,
      passengerDOB: passengerDOB ? new Date(passengerDOB) : undefined,
      destination,
      checkInDate: checkInDate ? new Date(checkInDate) : undefined,
      checkOutDate: checkOutDate ? new Date(checkOutDate) : undefined,
      adultsCount: adultsCount ? Number(adultsCount) : 1,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      departureAirport,
      arrivalAirport,
      flightDate: flightDate ? new Date(flightDate) : undefined,
      returnDate: returnDate ? new Date(returnDate) : undefined,

      platform: serviceType === "Flight" ? "Nouvelair" : "Booking.com",
      status: "Pending",
    });

    await booking.save();

    console.log(`📝 New booking received: ${booking._id}`);
    console.log(`   Client: ${clientName}`);
    console.log(`   Service Type: ${serviceType || "Hotel"}`);
    if (serviceType === "Flight") {
      console.log(`   Route: ${departureAirport} → ${arrivalAirport}`);
      console.log(`   Date: ${flightDate}`);
    } else {
      console.log(`   Destination: ${destination}`);
      console.log(`   Dates: ${checkInDate} to ${checkOutDate}`);
    }

    res.status(201).json({
      success: true,
      message: "Booking received successfully",
      bookingId: booking._id,
    });
  } catch (error) {
    console.error("❌ Error saving booking:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save booking",
    });
  }
});

/**
 * GET /api/bookings
 * Retrieve all bookings (for admin purposes)
 */
app.get("/api/bookings", async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, bookings });
  } catch (error) {
    console.error("❌ Error fetching bookings:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch bookings" });
  }
});

/**
 * GET /api/bookings/:id
 * Retrieve a single booking by ID
 */
app.get("/api/bookings/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }
    res.json({ success: true, booking });
  } catch (error) {
    console.error("❌ Error fetching booking:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch booking" });
  }
});

// ========== SERVE FRONTEND ==========
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ========== START SERVER ==========
async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log("═".repeat(50));
    console.log("🚀 Travel Automation Server Started");
    console.log("═".repeat(50));
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📋 Booking Form: http://localhost:${PORT}/`);
    console.log(`📡 API Endpoint: http://localhost:${PORT}/api/submit-booking`);
    console.log("═".repeat(50));
  });
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await mongoose.disconnect();
  process.exit(0);
});

startServer();
