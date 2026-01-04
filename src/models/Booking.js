import mongoose from "mongoose";

const BookingSchema = new mongoose.Schema({
  // Client Information
  clientName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  country: {
    type: String,
    trim: true,
  },
  passportNumber: {
    type: String,
    trim: true,
  },
  passengerDOB: {
    type: Date,
  },

  // Multiple Passengers (for group flight bookings)
  passengersList: [
    {
      clientName: {
        type: String,
        trim: true,
      },
      passportNumber: {
        type: String,
        trim: true,
      },
      passengerDOB: {
        type: Date,
      },
      nationality: {
        type: String,
        trim: true,
      },
      title: {
        type: String,
        trim: true,
      },
    },
  ],

  // Passenger counts (for multi-passenger flights)
  adults: {
    type: Number,
    min: 1,
    default: 1,
  },
  children: {
    type: Number,
    min: 0,
    default: 0,
  },
  infants: {
    type: Number,
    min: 0,
    default: 0,
  },

  // Service Type (Hotel or Flight)
  serviceType: {
    type: String,
    enum: ["Hotel", "Flight"],
    default: "Hotel",
  },

  // Booking Platform
  platform: {
    type: String,
    enum: ["Booking.com", "Nouvelair", "Booking.com (SIMULATION)", "Web Form"],
    default: "Booking.com",
  },

  // Destination (for hotels)
  destination: {
    type: String,
    trim: true,
  },

  // Flight-specific fields
  departureAirport: {
    type: String,
    trim: true,
  },
  arrivalAirport: {
    type: String,
    trim: true,
  },
  flightDate: {
    type: Date,
  },
  returnDate: {
    type: Date,
  },
  flightNumber: {
    type: String,
    trim: true,
  },

  // Booking Details
  pnr: {
    type: String,
    trim: true,
    index: true,
  },
  hotelName: {
    type: String,
    trim: true,
  },
  price: {
    type: Number,
    min: 0,
  },
  minPrice: {
    type: Number,
    min: 0,
  },
  maxPrice: {
    type: Number,
    min: 0,
  },
  adultsCount: {
    type: Number,
    min: 1,
    default: 1,
  },

  // Dates (for hotels)
  checkInDate: {
    type: Date,
  },
  checkOutDate: {
    type: Date,
  },

  // Status Management
  status: {
    type: String,
    enum: ["Pending", "Processing", "Confirmed", "Cancelled", "Failed"],
    default: "Pending",
  },

  // Error message for user feedback
  errorMessage: {
    type: String,
    trim: true,
  },

  // Number of retry attempts performed by the worker (incremented on transient failures)
  attempts: {
    type: Number,
    default: 0,
    min: 0,
  },

  // PDF file path for tickets/confirmations
  pdfPath: {
    type: String,
    trim: true,
  },

  // Free cancellation deadline (date before which cancellation is free)
  freeCancellationDeadline: {
    type: Date,
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient queries
BookingSchema.index({ status: 1 });
BookingSchema.index({ email: 1 });

const Booking = mongoose.model("Booking", BookingSchema);

export default Booking;
