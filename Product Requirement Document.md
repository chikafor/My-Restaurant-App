# Product Requirement Document (PRD)

---

## 1. Executive Summary & Overview

### 1.1 Project Title

**Single-Restaurant Ordering & Delivery System**

### 1.2 Objective

To build a responsive, mobile-optimized Web Application that enables customers to seamlessly explore menu offerings, customize items, place orders for takeaway/pickup or local delivery (within 3 km), and make payments online or offline.

The system equips restaurant operators with dedicated management interfaces for kitchen fulfillment, manual order acceptance/rejection, driver allocation, real-time status updates via push notifications, support ticketing, menu inventory toggling, and business analytics.

---

## 2. Platform Architecture & User Roles

### 2.1 Target Platforms

* **Customer Interface:** Mobile-responsive Web Application (accessible via standard mobile and desktop browsers).
* **Kitchen Staff & Driver Interface:** Mobile-responsive Web Application optimized for mobile phones and tablets.
* **Admin / Manager Portal:** Desktop & mobile-responsive Web Dashboard.

### 2.2 User Roles & Permissions Matrix

| Role | Access Level | Primary Functions |
| --- | --- | --- |
| **Customer** | Authenticated User / Account Holder | Browse menu, customize items, place orders (Pickup / 3 km Delivery), select payment method, view order status, submit support tickets via in-app chat. |
| **Kitchen Staff** | Staff Authenticated User | View incoming orders, manually accept/reject orders, transition order status (`Accepted` $\rightarrow$ `Preparing` $\rightarrow$ `Ready for Pickup`), toggle menu items on/off ("Out of Stock"), assign delivery orders to drivers. |
| **Delivery Driver** | Staff / Driver Authenticated User | View assigned delivery orders, view delivery address/customer notes, update order status to `Out for Delivery` and `Delivered`. |
| **Restaurant Admin / Manager** | Super Administrator | View sales/business analytics, set/update operating hours, manage staff/driver user accounts, oversee menu items, review support tickets. |

---

## 3. Detailed Core Features & Functional Requirements

### 3.1 Customer Experience (Customer Web App)

#### 3.1.1 User Authentication

* **Account Creation & Login:**
* OAuth 2.0 Integration: **Sign in with Google**.
* Phone Number Authentication (OTP / SMS Verification).


* **User Profile:**
* Manage saved delivery addresses (with automatic distance validation against the 3 km geo-fence).
* Contact phone number and preferred display name.



#### 3.1.2 Ordering Flow (Pickup vs. Delivery)

* **Fulfillment Selection:**
* **Takeaway / Pickup:** Standard grab-and-go counter pickup at the restaurant location.
* **Delivery:** Strict radius restriction enforced (**maximum 3 km** from the restaurant). Address entry validates location using geofencing. Addresses outside 3 km are prevented from proceeding with delivery.


* **Menu Browsing & Search:**
* Categorized menu view (e.g., Mains, Sides, Drinks, Desserts).
* Visual indicators for available vs. "Sold Out / Out of Stock" items.


* **Item Customization:**
* Support for option groups: Single-select (e.g., Spice Level: Mild / Medium / Hot) and Multi-select (e.g., Extra Toppings: Cheese, Mushrooms, Bacon).
* Special preparation notes text field per order item.


* **Payment Methods:**
* **Online Payment:** Integrated payment gateway (Credit/Debit Cards, Mobile Wallet / Bank Transfer).
* **Offline Payment:** Cash/Card on Pickup, or Cash/Card on Delivery.



#### 3.1.3 Order Tracking & Customer Notifications

* **Status Pipeline:**
1. `Order Placed` (Pending Acceptance)
2. `Accepted` (Kitchen accepted the order)
3. `Preparing` (Food is being cooked)
4. `Ready for Pickup` (For Takeaway orders) OR `Out for Delivery` (For Delivery orders)
5. `Completed` / `Delivered`


* **Notifications:** Browser Push Notifications sent automatically as the order moves through each status phase. *(Note: Real-time driver map tracking is intentionally omitted per requirements).*

#### 3.1.4 Customer Support & In-App Chat

* Integrated in-app chat / ticketing system for active or past orders.
* Customers can send text messages/queries regarding order updates, missing items, or delivery delays.

---

### 3.2 Kitchen & Staff Operations (Staff Web App)

#### 3.2.1 Order Fulfillment Queue

* **Real-time Order Feed:** Audio and visual alerting when a new order arrives.
* **Manual Acceptance Workflow:**
* Staff manually clicks **Accept** or **Reject** (with optional rejection reason).


* **Order Status Controls:**
* Advance order from `Accepted` $\rightarrow$ `Preparing` $\rightarrow$ `Ready for Pickup`.



#### 3.2.2 Delivery Assignment

* For delivery orders, kitchen staff manually assigns an available **Delivery Driver** from a drop-down list of active drivers.

#### 3.2.3 Dynamic Menu Inventory Control

* One-tap toggle switch to quickly set menu items or customization options as **"Out of Stock" / "Sold Out"**, instantly updating the Customer Web App menu view.

---

### 3.3 Driver Operations (Driver View)

* **Assigned Queue:** List of active delivery orders assigned to the logged-in driver.
* **Order Details:** Order summary, customer contact phone number, delivery address, and special delivery notes.
* **Status Updates:** Button to transition order from `Ready for Pickup` $\rightarrow$ `Out for Delivery` $\rightarrow$ `Delivered`.

---

### 3.4 Admin & Management Portal (Admin Web Dashboard)

#### 3.4.1 Business Analytics & Reporting

* **Key Metrics Dashboard:** Total Revenue (Daily / Weekly / Monthly), Order Volume, Pickup vs. Delivery ratio, Average Order Value.
* **Top-Selling Items:** Analytics breaking down most popular dishes and peak ordering hours.

#### 3.4.2 Account & Operations Management

* **Staff & Driver Account Management:** Create, edit, and deactivate accounts for Kitchen Staff and Drivers.
* **Restaurant Operating Hours:** Set daily store open/close hours and manually switch store status to "Closed" in emergency/busy situations.
* **Customer Support Desk:** View, assign, and respond to incoming customer support tickets/chats.

---

## 4. Technical Architecture & Non-Functional Requirements

```
[ Customer Web App ]       [ Kitchen/Driver Web App ]       [ Admin Portal ]
         │                             │                           │
         └─────────────────────────────┼───────────────────────────┘
                                       ▼
                       [ REST / WebSocket API Gateway ]
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
   [ Auth Service ]            [ Order Engine ]           [ Support/Chat ]
 (Google OAuth / OTP)       (Geofencing 3km Check)         (Ticketing API)
            │                          │                          │
            └──────────────────────────┼──────────────────────────┘
                                       ▼
                         [ Primary Database / Storage ]

```

### 4.1 Non-Functional Requirements

* **Performance:** Mobile-first responsive web design with page load times under 2 seconds.
* **Reliability & Low Latency:** Low-latency WebSockets or real-time event streaming for kitchen audio/visual alerts and order status changes.
* **Geofencing Accuracy:** Precise Google Maps / Mapbox API integration to enforce the 3 km delivery boundary from the restaurant's fixed location coordinates.
* **Security & Compliance:** HTTPS/TLS encryption across all endpoints; secure token handling (JWT/OAuth) for session management; PCI-DSS compliance via payment processor integration (e.g., Stripe, Paystack).

---

## 5. Summary of Scope Exclusions (Out of Scope)

* Multi-restaurant/multi-vendor capabilities.
* In-restaurant QR table ordering.
* Real-time GPS live map tracking of delivery drivers.
* Discount code or coupon engine.
