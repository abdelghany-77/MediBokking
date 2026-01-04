<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Playwright-1.57+-2EAD33?style=for-the-badge&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/MongoDB-8.0+-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express">
</p>

<h1 align="center">✈️ MediBooking</h1>

<p align="center">
  <strong>Premium Travel Automation System for Hotel & Flight Bookings</strong>
</p>

<p align="center">
  A powerful, automated travel booking platform that streamlines hotel reservations on Booking.com and flight bookings on Nouvelair. Built with Playwright browser automation and a beautiful modern web interface.
</p>

---

## ✨ Features

### 🏨 Hotel Booking Automation

- **Smart Search**: Automated destination search with autocomplete handling
- **Date Management**: Intelligent calendar navigation and date selection
- **Budget Filtering**: Price range filtering (per night) to find hotels within your budget
- **Free Cancellation**: Automatically filters for hotels with free cancellation policies
- **No Prepayment**: Prioritizes "Pay at Property" options to avoid online payment requirements
- **Account Rotation**: Supports multiple Booking.com sessions for enhanced reliability

### ✈️ Flight Booking Automation

- **Nouvelair Integration**: Automated flight search and booking on Nouvelair
- **Multi-Passenger Support**: Group bookings with multiple passengers in a single reservation
- **Round-Trip Support**: Book one-way or round-trip flights
- **Passport Management**: Automatic entry of passenger passport details

### 📊 Admin Dashboard

- **Booking Management**: View, manage, and track all bookings
- **Status Tracking**: Monitor pending, confirmed, and cancelled bookings
- **PDF Generation**: Generate and regenerate booking confirmation PDFs
- **Email Notifications**: Automated confirmation emails with PDF attachments

### 🎨 Modern Web Interface

- **Premium Design**: Glassmorphism UI with animated gradients
- **Responsive Layout**: Works beautifully on desktop and mobile devices
- **Intuitive Forms**: Easy-to-use booking forms with validation
- **Real-time Feedback**: Instant booking status updates

---

## 🛠️ Tech Stack

| Technology     | Purpose               |
| -------------- | --------------------- |
| **Node.js**    | Runtime environment   |
| **Express.js** | Web server & API      |
| **Playwright** | Browser automation    |
| **MongoDB**    | Database for bookings |
| **PDFKit**     | PDF generation        |
| **Nodemailer** | Email notifications   |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **MongoDB** (local or cloud instance)
- **npm** or **yarn**

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/MediBokking.git
   cd MediBokking
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install Playwright browsers**

   ```bash
   npx playwright install chromium
   ```

4. **Configure environment variables**

   Copy the example environment file and configure it:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your settings:

   ```env
   # MongoDB
   MONGODB_URI=mongodb://127.0.0.1:27017/travel_automation

   # Playwright / Browser
   PLAYWRIGHT_HEADLESS=true
   PLAYWRIGHT_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64)...

   # Booking credentials (for session management)
   BOOKING_EMAIL=your_email@example.com
   BOOKING_PASSWORD=your_password

   # SMTP / Email
   SMTP_SERVICE=gmail
   SMTP_USER=your_smtp_user
   SMTP_PASS=your_smtp_password
   FROM_EMAIL=noreply@example.com
   ```

5. **Start the server**

   ```bash
   npm run server
   ```

   The application will be available at `http://localhost:3000`

---

## 📁 Project Structure

```
MediBokking/
├── public/                 # Frontend static files
│   ├── index.html         # Main booking form
│   ├── admin.html         # Admin dashboard
│   └── login.html         # Admin login page
├── src/
│   ├── automation/        # Browser automation engines
│   │   ├── booking_engine.js     # Booking.com automation
│   │   ├── nouvelair_engine.js   # Nouvelair flight booking
│   │   ├── cancellation_engine.js
│   │   ├── login.js              # Session login handler
│   │   └── check_session.js      # Session validator
│   ├── config/
│   │   └── db.js          # MongoDB connection config
│   ├── models/
│   │   └── Booking.js     # Mongoose booking schema
│   ├── services/
│   │   ├── email_service.js   # Email sending service
│   │   ├── pdf_generator.js   # PDF ticket generation
│   │   └── scheduler.js       # Cron job scheduler
│   ├── index.js           # Main entry point
│   ├── server.js          # Express API server
│   └── worker.js          # Background job processor
├── auth*.json             # Saved browser sessions
├── package.json
└── .env.example           # Environment template
```

---

## 📋 Available Scripts

| Command                 | Description                      |
| ----------------------- | -------------------------------- |
| `npm run server`        | Start the Express web server     |
| `npm start`             | Run the main automation system   |
| `npm run login`         | Generate new Booking.com session |
| `npm run check-session` | Validate existing sessions       |
| `npm run book`          | Run booking engine directly      |

---

## 🔧 API Endpoints

### Public API

| Method | Endpoint              | Description                  |
| ------ | --------------------- | ---------------------------- |
| `POST` | `/api/submit-booking` | Submit a new booking request |

### Admin API (Protected)

| Method | Endpoint                    | Description               |
| ------ | --------------------------- | ------------------------- |
| `GET`  | `/api/admin/bookings`       | Get all bookings          |
| `POST` | `/api/admin/delete/:id`     | Delete a booking          |
| `POST` | `/api/admin/resend-pdf/:id` | Resend confirmation email |

---

## 🖼️ Screenshots

### Booking Form

The modern, premium booking interface with animated gradients and glassmorphism design.

### Admin Dashboard

Complete booking management system with status tracking and quick actions.

---

## 🔐 Security Notes

- **Session Management**: Browser sessions are stored locally in `auth*.json` files
- **Credentials**: Never commit your `.env` file or session files to version control
- **Admin Access**: The admin panel is protected with session-based authentication
- **HTTPS**: In production, always use HTTPS for secure data transmission

---