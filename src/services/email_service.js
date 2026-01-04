import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

if (!SMTP_USER || !SMTP_PASS) {
  console.error(" Error: SMTP_USER or SMTP_PASS is missing in .env file");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
    ciphers: "SSLv3",
  },
});

/**
 * Send Booking Confirmation Email
 */
async function sendTicketEmail(clientEmail, clientName, pdfPath) {
  try {
    console.log(`📧 Sending email to ${clientEmail}...`);

    const mailOptions = {
      from: `"Travel Agency" <${FROM_EMAIL}>`,
      to: clientEmail,
      subject: "✈️ Your Booking Confirmation & Ticket",
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #003580; text-align: center;">Booking Confirmed!</h2>
          <hr style="border: 0; border-top: 1px solid #eee;">
          <p>Dear <strong>${clientName}</strong>,</p>
          <p>Thank you for choosing our services. We are pleased to confirm your reservation.</p>
          <p><strong>Please find your official electronic ticket attached to this email.</strong></p>
          <div style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <p style="margin: 0; font-size: 14px; color: #555;">💡 Tip: Keep this document handy on your phone or print it before arriving at the hotel.</p>
          </div>
          <p style="font-size: 12px; color: gray; text-align: center; margin-top: 30px;">
            Safe travels,<br>Travel Agency Team
          </p>
        </div>
      `,
      attachments: [
        {
          filename: path.basename(pdfPath),
          path: pdfPath,
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully!");
    console.log("📩 Message ID:", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    return false;
  }
}

/**
 * Send Flight Confirmation Email with PDF Attachments
 * @param {Object} booking - The booking object
 * @param {string[]} pdfPaths - Array of PDF file paths to attach
 */
async function sendFlightConfirmationEmail(booking, pdfPaths) {
  try {
    const passengerCount = booking.passengersList?.length || 1;
    const passengerNames =
      booking.passengersList?.map((p) => p.clientName).join(", ") ||
      booking.clientName;

    console.log(`📧 Sending flight confirmation to ${booking.email}...`);
    console.log(
      `   📋 ${passengerCount} passenger(s), ${pdfPaths.length} PDF(s) attached`
    );

    // Build attachments array
    const attachments = pdfPaths.map((pdfPath) => ({
      filename: path.basename(pdfPath),
      path: pdfPath,
    }));

    const depAirport = booking.departureAirport || "TUN";
    const arrAirport = booking.arrivalAirport || "DEST";
    const flightDate = booking.flightDate
      ? new Date(booking.flightDate).toLocaleDateString("en-GB", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "TBD";

    const returnInfo = booking.returnDate
      ? `
      <tr>
        <td style="padding: 8px 0; color: #555;">Return Date</td>
        <td style="padding: 8px 0; font-weight: bold;">${new Date(
          booking.returnDate
        ).toLocaleDateString("en-GB", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}</td>
      </tr>`
      : "";

    const mailOptions = {
      from: `"Travel Agency" <${FROM_EMAIL}>`,
      to: booking.email,
      subject: `✈️ Flight Confirmation - ${depAirport} → ${arrAirport} | ${
        booking.pnr || "Booking Confirmed"
      }`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #333; max-width: 650px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
          <div style="background: linear-gradient(135deg, #663399 0%, #4a2470 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">✈️ Your Flight is Confirmed!</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Booking Reference: <strong style="font-size: 20px;">${
              booking.pnr || "PENDING"
            }</strong></p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <p style="font-size: 16px;">Dear <strong>${
              booking.clientName
            }</strong>,</p>
            
            <p>Thank you for booking with us. Your flight reservation has been confirmed.</p>
            
            <div style="background: #f0f4f8; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px; color: #663399;">Flight Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #555;">Route</td>
                  <td style="padding: 8px 0; font-weight: bold;">${depAirport} → ${arrAirport}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Departure Date</td>
                  <td style="padding: 8px 0; font-weight: bold;">${flightDate}</td>
                </tr>
                ${returnInfo}
                <tr>
                  <td style="padding: 8px 0; color: #555;">Passengers</td>
                  <td style="padding: 8px 0; font-weight: bold;">${passengerNames}</td>
                </tr>
                ${
                  booking.price
                    ? `
                <tr>
                  <td style="padding: 8px 0; color: #555;">Total Price</td>
                  <td style="padding: 8px 0; font-weight: bold; color: #663399;">${booking.price} TND</td>
                </tr>`
                    : ""
                }
              </table>
            </div>
            
            <div style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0;">
              <strong>📎 Your E-Tickets are Attached</strong>
              <p style="margin: 5px 0 0; font-size: 14px; color: #555;">
                Please find ${
                  passengerCount > 1
                    ? `${passengerCount} e-tickets (one per passenger)`
                    : "your e-ticket"
                } attached to this email.
                Keep ${
                  passengerCount > 1 ? "these documents" : "this document"
                } handy on your phone or print before arriving at the airport.
              </p>
            </div>
            
            <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0;">
              <strong>⚠️ Important Reminders</strong>
              <ul style="margin: 10px 0 0; padding-left: 20px; color: #555; font-size: 14px;">
                <li>Arrive at the airport at least 2.5 hours before departure</li>
                <li>Carry valid ID/passport for all passengers</li>
                <li>Check baggage allowance on your ticket</li>
              </ul>
            </div>
            
            <p style="font-size: 12px; color: #888; text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
              Safe travels!<br>
              <strong>Travel Agency Team</strong><br>
              <em>This is an automated email. Please do not reply directly.</em>
            </p>
          </div>
        </div>
      `,
      attachments: attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Flight confirmation email sent successfully!");
    console.log("📩 Message ID:", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Error sending flight confirmation email:", error.message);
    return false;
  }
}

export { sendTicketEmail, sendFlightConfirmationEmail };
