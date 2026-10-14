# Single-Restaurant Ordering & Delivery System

A responsive, real-time web application built precisely to the specifications in the **Product Requirement Document (PRD)**.

---

## 🌟 Key Features Implemented

### 1. Customer Experience (Customer Web App)
- **Menu Browsing & Search**: Categorized dishes (Signature Burgers, Artisan Pizzas, Bowls & Greens, Sides & Appetizers, Craft Drinks, Sweet Desserts), dietary labels (Vegetarian, Halal, Spicy, Gluten-Free), real-time search.
- **Item Customization**: Single-select option groups (e.g. Spice Level, Crust Style, Wings Sauce) and multi-select add-ons (Extra Bacon, Melted Aged Cheddar, Truffle Aioli, Free-Range Egg) with dynamic price calculation and special kitchen preparation notes.
- **Strict 3 km Geofence Delivery Radius**:
  - Distance calculation using the spherical **Haversine formula** from the restaurant's fixed coordinates (`51.5074, -0.1278`).
  - Interactive preset testing addresses:
    - *Flat 4B, 18 Camden Walk* (1.2 km away) $\rightarrow$ **Eligible ✅**
    - *Tech Hub Suite 204, River Way* (2.4 km away) $\rightarrow$ **Eligible ✅**
    - *88 Northwood Crescent* (4.5 km away) $\rightarrow$ **Ineligible / Strictly Blocked 🚫**
  - Instant server-side and client-side validation preventing delivery checkout beyond 3 km.
- **Fulfillment Selection**: Seamlessly toggle between **Local 3 km Delivery** (with delivery fee) and **Counter Takeaway / Pickup** ($0 fee).
- **Payment Methods**:
  - Online Payment (Credit/Debit Card, Mobile Wallet)
  - Offline Payment (Cash on Delivery/Pickup, Card on Delivery/Pickup)
- **Order Tracking Pipeline**:
  - Live 5-stage progress pipeline: `Order Placed` $\rightarrow$ `Accepted` $\rightarrow$ `Preparing` $\rightarrow$ `Ready for Pickup / Out for Delivery` $\rightarrow$ `Delivered`.
  - Browser Push Notifications (Web Notification API) & pleasant synthesized audio alerts.
- **In-App Customer Support & Chat**:
  - Integrated customer messaging thread linked to active/past orders or general inquiries.

---

### 2. Kitchen & Staff Operations (Kitchen Display System - KDS)
- **Real-Time Order Feed**: Instant audio chime alert (Web Audio API synthesized two-tone alert) and visual flashing card pulse whenever a new order is submitted.
- **Manual Acceptance Workflow**: Staff clicks **Accept** (moves to `Accepted`) or **Reject** with modal rejection reason (e.g. "Kitchen at capacity", "Ingredient unavailable").
- **Order Status Controls**: Advance status through `Preparing` $\rightarrow$ `Ready for Pickup / Dispatch`.
- **Delivery Driver Allocation**: Drop-down selector of active delivery drivers showing vehicle type and current active order load.
- **Dynamic 1-Tap Menu Inventory Control**:
  - Instant toggle switch for menu items and customization options ("In Stock" $\leftrightarrow$ "Sold Out / Out of Stock").
  - Instantly syncs across all connected customer screens in real-time via Server-Sent Events (SSE).

---

### 3. Delivery Driver Operations (Driver View)
- **Assigned Queue**: Mobile-optimized list of orders assigned to the logged-in driver.
- **Delivery Details**: Customer name, click-to-call phone link (`tel:`), delivery address, exact distance in km, and special customer delivery notes.
- **Payment Verification**: Clear distinction between orders already paid online and orders requiring cash collection upon delivery.
- **Status Updates**: 1-tap transition from `Ready for Pickup` $\rightarrow$ `Out for Delivery` $\rightarrow$ `Delivered`.
- **Delivery History Log**: Timestamped record of completed deliveries.

---

### 4. Admin & Management Portal
- **Business Analytics & Reporting**:
  - Real-time KPI Cards: Total Revenue, Total Order Volume, Average Order Value (AOV), Delivery vs. Pickup ratio.
  - Interactive period filtering: *Today*, *Last 7 Days*, *Last 30 Days*, *All Time*.
  - Top-Selling Dishes chart with unit volume and revenue breakdown.
  - Peak Ordering Hours hourly distribution chart.
- **Operations & Operating Hours**:
  - Emergency Store Status Switch: Toggle the restaurant "Open" or "Closed" with a custom customer banner message.
  - Restaurant address, delivery radius (3.0 km), delivery fee, and daily opening/closing schedules.
- **Staff & Driver User Management**:
  - Create, view, and toggle active/inactive status for Kitchen Staff and Delivery Drivers.
- **Customer Support Desk**:
  - Unified ticketing inbox with Open, In-Progress, and Resolved filters.
  - Real-time conversation thread with live reply composer and 1-click "Mark Resolved".

---

## 🛠️ Architecture & Zero External Dependencies

- **Backend**: Multithreaded Python HTTP Server (`server.py`) with Server-Sent Events (SSE) broadcast hub, REST API, and SQLite database (`restaurant.db`).
- **Database**: SQLite with schema for users, addresses, categories, menu items, option groups, option choices, orders, order items, status logs, support tickets, and restaurant settings.
- **Frontend**: Clean Vanilla JavaScript (ES6 modules `app.js`, `customer.js`, `kitchen.js`, `driver.js`, `admin.js`, `audio.js`) and CSS (`style.css`).
- **Real-Time Layer**: HTTP Server-Sent Events (SSE) `/api/events` with automatic reconnection.
- **Audio & Push**: Web Audio API sound synthesis + Web Notification API.

---

## 🚀 How to Run the Application

```bash
# In this directory:
./run.sh 8000
# or
python3 server.py 8000
```

Then open your browser at:
👉 **`http://localhost:8000`**

---

## 🧪 Automated Test Suite

Run the end-to-end automated test suite:

```bash
python3 test_app.py
```

All 9 comprehensive tests verify:
1. Static asset delivery & SPA routes
2. Menu categorization & item customization options
3. Geofencing 3 km distance calculation
4. Strict enforcement of 3 km limit on order placement
5. Kitchen order acceptance, preparation, and driver allocation
6. Driver delivery status progression
7. Dynamic menu inventory out-of-stock toggling
8. Admin business analytics & settings
9. Support desk live ticketing and message replies

---

## 👥 Demo Pre-Seeded Accounts

The application features a 1-click **Role Switcher** at the top of the screen:

| Role | Demo User | Email | Functions |
|---|---|---|---|
| **Customer** | Sarah Jenkins | `customer@example.com` | Browse menu, customize items, test 3 km geofence, place orders, track live status, chat support |
| **Kitchen Staff** | Chef Marco Rossi | `kitchen@example.com` | KDS queue, audio alerts, accept/reject, mark cooking/ready, assign driver, toggle stock |
| **Delivery Driver** | Alex 'Speedy' Vance | `driver@example.com` | View assigned orders, customer address, click-to-call, mark out for delivery & delivered |
| **Admin / Manager** | Eleanor Vance (GM) | `admin@example.com` | Sales analytics, peak hours, operating hours, emergency switch, staff accounts, support desk |
