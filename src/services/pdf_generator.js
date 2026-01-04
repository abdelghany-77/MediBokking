import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

// Agency configuration from environment
const AGENCY_NAME = process.env.AGENCY_NAME || "";
const AGENCY_ADDRESS =
  process.env.AGENCY_ADDRESS ||
  "RUE ITALIE IMMEUBLE BOUCHRA\n4000 SOUSSE\nTUNISIA";
const AGENCY_PHONE = process.env.AGENCY_PHONE || "+216 506 89 836";

// Airport data for enhanced display
const AIRPORT_DATA = {
  TUN: {
    city: "TUNIS",
    country: "TN",
    name: "CARTHAGE",
    terminal: "TERMINAL M - MAIN TERMINAL",
  },
  ORY: {
    city: "PARIS",
    country: "FR",
    name: "ORLY",
    terminal: "TERMINAL 4 - ORLY 4",
  },
  CDG: {
    city: "PARIS",
    country: "FR",
    name: "CHARLES DE GAULLE",
    terminal: "TERMINAL 2E",
  },
  MRS: {
    city: "MARSEILLE",
    country: "FR",
    name: "PROVENCE",
    terminal: "TERMINAL 1",
  },
  LYS: {
    city: "LYON",
    country: "FR",
    name: "SAINT EXUPERY",
    terminal: "TERMINAL 1",
  },
  NCE: {
    city: "NICE",
    country: "FR",
    name: "COTE D'AZUR",
    terminal: "TERMINAL 2",
  },
  TLS: {
    city: "TOULOUSE",
    country: "FR",
    name: "BLAGNAC",
    terminal: "TERMINAL 1",
  },
  BOD: {
    city: "BORDEAUX",
    country: "FR",
    name: "MERIGNAC",
    terminal: "TERMINAL A",
  },
  DJE: {
    city: "DJERBA",
    country: "TN",
    name: "ZARZIS",
    terminal: "MAIN TERMINAL",
  },
  MIR: {
    city: "MONASTIR",
    country: "TN",
    name: "HABIB BOURGUIBA",
    terminal: "MAIN TERMINAL",
  },
  SFA: {
    city: "SFAX",
    country: "TN",
    name: "THYNA",
    terminal: "MAIN TERMINAL",
  },
  TOE: {
    city: "TOZEUR",
    country: "TN",
    name: "NEFTA",
    terminal: "MAIN TERMINAL",
  },
  NBE: {
    city: "ENFIDHA",
    country: "TN",
    name: "HAMMAMET",
    terminal: "MAIN TERMINAL",
  },
  // Turkey
  IST: {
    city: "ISTANBUL",
    country: "TR",
    name: "ISTANBUL AIRPORT",
    terminal: "INTERNATIONAL TERMINAL",
  },
  SAW: {
    city: "ISTANBUL",
    country: "TR",
    name: "SABIHA GOKCEN",
    terminal: "INTERNATIONAL TERMINAL",
  },
  AYT: {
    city: "ANTALYA",
    country: "TR",
    name: "ANTALYA",
    terminal: "TERMINAL 1",
  },
  // Italy
  FCO: {
    city: "ROME",
    country: "IT",
    name: "FIUMICINO",
    terminal: "TERMINAL 3",
  },
  MXP: {
    city: "MILAN",
    country: "IT",
    name: "MALPENSA",
    terminal: "TERMINAL 1",
  },
  // Other Europe
  LHR: {
    city: "LONDON",
    country: "UK",
    name: "HEATHROW",
    terminal: "TERMINAL 5",
  },
  BCN: {
    city: "BARCELONA",
    country: "ES",
    name: "EL PRAT",
    terminal: "TERMINAL 1",
  },
  FRA: {
    city: "FRANKFURT",
    country: "DE",
    name: "FRANKFURT",
    terminal: "TERMINAL 1",
  },
  AMS: {
    city: "AMSTERDAM",
    country: "NL",
    name: "SCHIPHOL",
    terminal: "TERMINAL 1",
  },
  BRU: {
    city: "BRUSSELS",
    country: "BE",
    name: "ZAVENTEM",
    terminal: "TERMINAL A",
  },
  GVA: {
    city: "GENEVA",
    country: "CH",
    name: "COINTRIN",
    terminal: "TERMINAL 1",
  },
  ZRH: {
    city: "ZURICH",
    country: "CH",
    name: "KLOTEN",
    terminal: "TERMINAL 1",
  },
  // Middle East & Africa
  DXB: {
    city: "DUBAI",
    country: "AE",
    name: "DUBAI INTERNATIONAL",
    terminal: "TERMINAL 3",
  },
  CAI: {
    city: "CAIRO",
    country: "EG",
    name: "CAIRO INTERNATIONAL",
    terminal: "TERMINAL 2",
  },
  ALG: {
    city: "ALGIERS",
    country: "DZ",
    name: "HOUARI BOUMEDIENE",
    terminal: "TERMINAL 1",
  },
  CMN: {
    city: "CASABLANCA",
    country: "MA",
    name: "MOHAMMED V",
    terminal: "TERMINAL 1",
  },
  JED: {
    city: "JEDDAH",
    country: "SA",
    name: "KING ABDULAZIZ",
    terminal: "TERMINAL 1",
  },
};

// Airline data
const AIRLINE_DATA = {
  BJ: { name: "NOUVELAIR", equipment: "AIRBUS A320" },
  TU: { name: "TUNISAIR", equipment: "AIRBUS A320 (SHARKLETS)" },
};

/**
 * Get airport info with fallback
 */
function getAirportInfo(code) {
  return (
    AIRPORT_DATA[code] || {
      city: code,
      country: "",
      name: code,
      terminal: "MAIN TERMINAL",
    }
  );
}

/**
 * Get airline info from flight number
 */
function getAirlineInfo(flightNumber) {
  if (!flightNumber) return { name: "NOUVELAIR", equipment: "AIRBUS A320" };
  const code = flightNumber.substring(0, 2).toUpperCase();
  return AIRLINE_DATA[code] || { name: "NOUVELAIR", equipment: "AIRBUS A320" };
}

/**
 * Format passenger name with title
 */
function formatPassengerName(passenger) {
  const name = passenger.clientName || passenger.name || "GUEST";
  const parts = name.toUpperCase().trim().split(" ");

  // Format as LASTNAME/FIRSTNAME TITLE
  if (parts.length >= 2) {
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, -1).join(" ");
    const title = passenger.title || "MR";
    return `${lastName}/${firstName} ${title}`;
  }
  return name;
}

/**
 * Format date for display
 */
function formatDate(date) {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, "0");
  const months = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Format date with day of week for flight display
 */
function formatFlightDate(date) {
  const d = new Date(date);
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const dayOfWeek = days[d.getDay()];
  const day = d.getDate().toString().padStart(2, "0");
  const months = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayOfWeek} ${day} ${month} ${year}`;
}

/**
 * Format short date (DD MMM)
 */
function formatShortDate(date) {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, "0");
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const month = months[d.getMonth()];
  return `${day} ${month}`;
}

/**
 * Generate random flight time (for demo/placeholder)
 */
function generateFlightTime(isReturn = false) {
  const hour = isReturn
    ? 10 + Math.floor(Math.random() * 4)
    : 17 + Math.floor(Math.random() * 4);
  const minute = Math.floor(Math.random() * 4) * 15;
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Calculate arrival time (departure + duration)
 */
function calculateArrivalTime(depTime, durationMinutes) {
  const [hours, minutes] = depTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const arrHours = Math.floor(totalMinutes / 60) % 24;
  const arrMinutes = totalMinutes % 60;
  return `${arrHours.toString().padStart(2, "0")}:${arrMinutes
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Format duration
 */
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Generate a 6-character booking reference
 */
function generateBookingRef() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ref = "";
  for (let i = 0; i < 6; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

/**
 * Draw a horizontal line
 */
function drawLine(doc, y, style = "solid") {
  const leftMargin = 50;
  const rightMargin = 550;

  doc.strokeColor("#666666");
  if (style === "dashed") {
    doc.dash(5, { space: 3 });
  }
  doc.moveTo(leftMargin, y).lineTo(rightMargin, y).stroke();
  doc.undash();
}

/**
 * Generate Flight Ticket PDF
 * @param {Object} booking - The booking object from database
 * @param {Object} passenger - Individual passenger object
 * @param {number} passengerIndex - Index of the passenger (1-based)
 * @returns {Promise<string>} - Path to generated PDF
 */
async function generateFlightTicketPDF(booking, passenger, passengerIndex = 1) {
  return new Promise((resolve, reject) => {
    try {
      // Ensure downloads directory exists
      const downloadsDir = path.join(__dirname, "../../downloads");
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }

      const pnr = booking.pnr || generateBookingRef();
      const passengerName = (passenger.clientName || passenger.name || "GUEST")
        .replace(/\s+/g, "_")
        .toUpperCase();
      const filename = `TICKET_${pnr}_${passengerName}_${Date.now()}.pdf`;
      const filepath = path.join(downloadsDir, filename);

      // Create PDF document
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
      });

      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // =====================================================================
      // HEADER SECTION
      // =====================================================================
      const leftMargin = 50;
      const rightColumn = 350;
      let y = 40;

      // Agency name
      doc
        .font("Helvetica")
        .fontSize(14)
        .fillColor("#663399")
        .text(AGENCY_NAME, leftMargin, y);

      y += 18;

      // Agency address
      doc.font("Helvetica").fontSize(9).fillColor("#333333");

      const addressLines = AGENCY_ADDRESS.split("\n");
      addressLines.forEach((line) => {
        doc.text(line, leftMargin, y);
        y += 12;
      });

      // Phone
      doc.text(`TELEPHONE: ${AGENCY_PHONE}`, leftMargin, y);

      // Right column - Booking Reference
      let yRight = 40;
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#333333")
        .text("BOOKING REF:", rightColumn, yRight)
        .font("Helvetica")
        .text(pnr, rightColumn + 80, yRight);

      yRight += 14;
      doc
        .font("Helvetica")
        .text("DATE:", rightColumn, yRight)
        .font("Helvetica")
        .text(formatDate(new Date()), rightColumn + 80, yRight);

      yRight += 20;
      // Passenger name
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(formatPassengerName(passenger), rightColumn, yRight);

      y = Math.max(y, yRight) + 30;

      // =====================================================================
      // FLIGHT SECTIONS
      // =====================================================================
      const depAirport = getAirportInfo(booking.departureAirport);
      const arrAirport = getAirportInfo(booking.arrivalAirport);
      const airline = getAirlineInfo(booking.flightNumber);

      // Generate flight details
      const flightNum =
        booking.flightNumber || `BJ ${700 + Math.floor(Math.random() * 100)}`;
      const depTime = generateFlightTime(false);
      const flightDuration = 140; // 2h20 average
      const arrTime = calculateArrivalTime(depTime, flightDuration);

      // =====================================================================
      // OUTBOUND FLIGHT
      // =====================================================================
      // Flight header
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#333333")
        .text("FLIGHT", leftMargin, y);

      doc
        .font("Helvetica")
        .text(`${flightNum} - ${airline.name}`, leftMargin + 60, y);

      doc
        .font("Helvetica")
        .text(formatFlightDate(booking.flightDate), rightColumn + 50, y);

      y += 14;
      drawLine(doc, y, "solid");
      y += 10;

      // Departure/Arrival info
      doc.font("Helvetica").fontSize(9);

      doc.text("DEPARTURE:", leftMargin, y);
      doc.text(
        `${depAirport.city}, ${depAirport.country} (${depAirport.name}), ${depAirport.terminal}`,
        leftMargin + 70,
        y
      );
      doc.text(
        `${formatShortDate(booking.flightDate)} ${depTime}`,
        rightColumn + 80,
        y
      );

      y += 12;
      doc.text("ARRIVAL:", leftMargin, y);
      doc.text(
        `${arrAirport.city}, ${arrAirport.country} (${arrAirport.name}), ${arrAirport.terminal}`,
        leftMargin + 70,
        y
      );
      doc.text(
        `${formatShortDate(booking.flightDate)} ${arrTime}`,
        rightColumn + 80,
        y
      );

      y += 12;
      doc.text(
        `FLIGHT BOOKING REF: ${airline.name.substring(0, 2)}/${pnr}`,
        leftMargin + 70,
        y
      );

      y += 12;
      doc.text("RESERVATION CONFIRMED, ECONOMY (Q)", leftMargin + 70, y);
      doc.text(
        `DURATION: ${formatDuration(flightDuration)}`,
        rightColumn + 50,
        y
      );

      y += 14;
      drawLine(doc, y, "dashed");
      y += 10;

      doc.text(`BAGGAGE ALLOWANCE:        0PC`, leftMargin + 70, y);

      y += 16;
      doc.font("Helvetica").text("NON STOP", leftMargin, y);
      doc
        .font("Helvetica")
        .text(`${depAirport.city} TO ${arrAirport.city}`, leftMargin + 70, y);

      y += 12;
      doc.text(`EQUIPMENT:`, leftMargin + 70, y);
      doc.text(airline.equipment, leftMargin + 150, y);

      y += 25;

      // =====================================================================
      // RETURN FLIGHT (if round trip)
      // =====================================================================
      if (booking.returnDate) {
        const retDepTime = generateFlightTime(true);
        const retArrTime = calculateArrivalTime(retDepTime, flightDuration);
        const retFlightNum = booking.flightNumber
          ? `${booking.flightNumber.substring(0, 2)} ${
              parseInt(booking.flightNumber.substring(2)) + 10
            }`
          : `BJ ${710 + Math.floor(Math.random() * 100)}`;

        // Flight header
        doc.font("Helvetica").fontSize(10).text("FLIGHT", leftMargin, y);

        doc
          .font("Helvetica")
          .text(`${retFlightNum} - ${airline.name}`, leftMargin + 60, y);

        doc
          .font("Helvetica")
          .text(formatFlightDate(booking.returnDate), rightColumn + 50, y);

        y += 14;
        drawLine(doc, y, "solid");
        y += 10;

        // Return flight - Airports swapped
        doc.font("Helvetica").fontSize(9);

        doc.text("DEPARTURE:", leftMargin, y);
        doc.text(
          `${arrAirport.city}, ${arrAirport.country} (${arrAirport.name}), ${arrAirport.terminal}`,
          leftMargin + 70,
          y
        );
        doc.text(
          `${formatShortDate(booking.returnDate)} ${retDepTime}`,
          rightColumn + 80,
          y
        );

        y += 12;
        doc.text("ARRIVAL:", leftMargin, y);
        doc.text(
          `${depAirport.city}, ${depAirport.country} (${depAirport.name}), ${depAirport.terminal}`,
          leftMargin + 70,
          y
        );
        doc.text(
          `${formatShortDate(booking.returnDate)} ${retArrTime}`,
          rightColumn + 80,
          y
        );

        y += 12;
        doc.text(
          `FLIGHT BOOKING REF: ${airline.name.substring(0, 2)}/${pnr}`,
          leftMargin + 70,
          y
        );

        y += 12;
        doc.text("RESERVATION CONFIRMED, ECONOMY (P)", leftMargin + 70, y);
        doc.text(
          `DURATION: ${formatDuration(flightDuration + 5)}`,
          rightColumn + 50,
          y
        );

        y += 14;
        drawLine(doc, y, "dashed");
        y += 10;

        doc.text(`BAGGAGE ALLOWANCE:        0PC`, leftMargin + 70, y);

        y += 16;
        doc.font("Helvetica").text("NON STOP", leftMargin, y);
        doc
          .font("Helvetica")
          .text(`${arrAirport.city} TO ${depAirport.city}`, leftMargin + 70, y);

        y += 12;
        doc.text(`EQUIPMENT:`, leftMargin + 70, y);
        doc.text("AIRBUS A320", leftMargin + 150, y);

        y += 25;
      }

      // =====================================================================
      // CO2 EMISSIONS
      // =====================================================================
      const co2 = (264.2 * (booking.returnDate ? 2 : 1)).toFixed(2);
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          `FLIGHT(S) CALCULATED AVERAGE CO2 EMISSIONS IS ${co2} KG/PERSON`,
          leftMargin,
          y
        );

      y += 30;
      // =====================================================================
      // DATA PROTECTION NOTICE
      // =====================================================================
      doc.font("Helvetica").fontSize(8).fillColor("#666666");

      const privacyText = `Data Protection Notice: Your personal data will be processed in accordance with the applicable carrier's privacy policy and, if your booking is made via a reservation system provider ("GDS"), with its privacy policy. These are available at or from the carrier or GDS directly. You should read this documentation, which applies to your booking and specifies, for example, how your personal data is collected, stored, used, disclosed and transferred. (applicable for interline carriage)`;

      doc.text(privacyText, leftMargin, y, {
        width: 500,
        align: "justify",
      });

      // Finalize PDF
      doc.end();

      stream.on("finish", () => {
        console.log(`   📄 PDF generated: ${filename}`);
        resolve(filepath);
      });

      stream.on("error", (error) => {
        console.error("   ❌ PDF stream error:", error);
        reject(error);
      });
    } catch (error) {
      console.error("   ❌ PDF generation error:", error);
      reject(error);
    }
  });
}

/**
 * Generate PDFs for all passengers in a booking
 * @param {Object} booking - The booking object with passengersList
 * @returns {Promise<string[]>} - Array of PDF file paths
 */
async function generateAllPassengerPDFs(booking) {
  const pdfPaths = [];

  // Get passengers list or create single-passenger array
  const passengers =
    booking.passengersList && booking.passengersList.length > 0
      ? booking.passengersList
      : [
          {
            clientName: booking.clientName,
            passportNumber: booking.passportNumber,
            passengerDOB: booking.passengerDOB,
            title: "MR",
          },
        ];

  console.log(`   📋 Generating ${passengers.length} ticket PDF(s)...`);

  for (let i = 0; i < passengers.length; i++) {
    const passenger = passengers[i];
    console.log(
      `   ✈️ Generating PDF for passenger ${i + 1}: ${
        passenger.clientName || "Guest"
      }`
    );

    try {
      const pdfPath = await generateFlightTicketPDF(booking, passenger, i + 1);
      pdfPaths.push(pdfPath);
    } catch (error) {
      console.error(
        `   ⚠️ Failed to generate PDF for passenger ${i + 1}:`,
        error.message
      );
    }
  }

  return pdfPaths;
}

export { generateFlightTicketPDF, generateAllPassengerPDFs };
