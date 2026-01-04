// import cron from "node-cron";
// import Booking from "../models/Booking.js";

// /**
//  * Process bookings that need auto-cancellation (6 Days Rule)
//  */
// async function processAutoCancellations() {
//   console.log("🔍 Checking for bookings to auto-cancel (6-day rule)...");

//   const today = new Date();
//   today.setHours(0, 0, 0, 0);

//   try {
//     // 1. Find ACTIVE Hotel bookings only
//     const bookings = await Booking.find({
//       serviceType: "Hotel",
//       status: "Confirmed",
//       checkInDate: { $exists: true }, // Must have a check-in date
//     });

//     if (bookings.length === 0) {
//       console.log("✅ No confirmed hotel bookings found.");
//       return;
//     }

//     // 2. Loop and Calculate Logic
//     for (const booking of bookings) {
//       const checkIn = new Date(booking.checkInDate);

//       // Calculate difference in Days
//       const diffTime = checkIn - today;
//       const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

//       // LOGIC: If 6 days or less remain, CANCEL IT.
//       if (diffDays <= 6 && diffDays >= 0) {
//         console.log(
//           `⚠️ ALERT: Booking ${booking._id} is due for cancellation! (${diffDays} days left)`
//         );

//         // Mark as Cancelled in DB
//         booking.status = "Cancelled";
//         await booking.save();

//         console.log(
//           `❌ Booking ${booking._id} marked as CANCELLED to prevent charges.`
//         );
//       }
//     }

//     console.log("✅ Auto-cancellation check completed.");
//   } catch (error) {
//     console.error("❌ Auto-cancellation error:", error.message);
//   }
// }

// /**
//  * Initialize the scheduler
//  */
// function initScheduler() {
//   console.log("⏰ Scheduler Initialized (Running daily at 08:00 AM)");

//   // Run every day at 08:00 AM
//   cron.schedule("0 8 * * *", async () => {
//     console.log("☀️ 08:00 AM - Starting Daily Cancellation Check...");
//     await processAutoCancellations();
//   });
// }

// export { initScheduler, processAutoCancellations };
