"""
Server module for Single-Restaurant Ordering & Delivery System.
High-performance multithreaded HTTP server with Server-Sent Events (SSE),
RESTful API, SQLite integration, and static file serving. Zero external dependencies!
"""

import http.server
import socketserver
import json
import sqlite3
import os
import sys
import math
import mimetypes
import urllib.parse
import threading
import time
import queue
import secrets
from datetime import datetime, timedelta

from database import get_db, init_db, hash_pw

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Thread-safe SSE broadcaster
class SSEBroadcaster:
    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def subscribe(self, client_queue):
        with self.lock:
            self.clients.add(client_queue)

    def unsubscribe(self, client_queue):
        with self.lock:
            self.clients.discard(client_queue)

    def broadcast(self, event_type, data):
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        with self.lock:
            dead_clients = set()
            for client_queue in self.clients:
                try:
                    client_queue.put_nowait(payload)
                except queue.Full:
                    dead_clients.add(client_queue)
            for dead in dead_clients:
                self.clients.discard(dead)

sse_broadcaster = SSEBroadcaster()

# Haversine distance in km
def haversine_km(lat1, lon1, lat2, lon2):
    try:
        R = 6371.0  # Earth radius in kilometers
        dlat = math.radians(float(lat2) - float(lat1))
        dlon = math.radians(float(lon2) - float(lon1))
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(float(lat1))) *
             math.cos(math.radians(float(lat2))) *
             math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return round(R * c, 2)
    except Exception:
        return 999.0

# Helper to fetch restaurant settings as dict
def get_restaurant_settings(conn):
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM restaurant_settings")
    rows = cur.fetchall()
    settings = {}
    for r in rows:
        val = r["value"]
        if val.lower() in ("true", "false"):
            settings[r["key"]] = (val.lower() == "true")
        else:
            try:
                settings[r["key"]] = json.loads(val)
            except Exception:
                try:
                    if "." in val:
                        settings[r["key"]] = float(val)
                    else:
                        settings[r["key"]] = int(val)
                except Exception:
                    settings[r["key"]] = val
    return settings

# In-memory sessions token -> user_dict
sessions = {}
sessions_lock = threading.Lock()

def create_session(user):
    token = secrets.token_hex(24)
    with sessions_lock:
        sessions[token] = user
    return token

def get_current_user(headers):
    auth_header = headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        with sessions_lock:
            return sessions.get(token)
    # Check cookie
    cookie_str = headers.get("Cookie", "")
    for part in cookie_str.split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            if k == "session_token":
                with sessions_lock:
                    return sessions.get(v)
    return None

class RestaurantRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": message, "success": False}, status=status)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def parse_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            return {}
        raw_body = self.rfile.read(content_length).decode("utf-8")
        try:
            return json.loads(raw_body)
        except Exception:
            return {}

    # -------------------------------------------------------------
    # GET Handlers
    # -------------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. SSE Real-Time Stream
        if path == "/api/events":
            self.handle_sse()
            return

        # 2. REST API Routes
        if path.startswith("/api/"):
            self.handle_api_get(path, query)
            return

        # 3. Static Files
        self.handle_static_files(path)

    def handle_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        client_queue = queue.Queue(maxsize=100)
        sse_broadcaster.subscribe(client_queue)

        # Initial hello event
        try:
            init_msg = f"event: connected\ndata: {json.dumps({'time': datetime.now().isoformat()})}\n\n"
            self.wfile.write(init_msg.encode("utf-8"))
            self.wfile.flush()
        except Exception:
            sse_broadcaster.unsubscribe(client_queue)
            return

        try:
            while True:
                try:
                    payload = client_queue.get(timeout=15)
                    self.wfile.write(payload.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # Heartbeat comment to keep HTTP connection alive
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            sse_broadcaster.unsubscribe(client_queue)

    def handle_api_get(self, path, query):
        conn = get_db()
        cur = conn.cursor()

        try:
            # Current User Session
            if path == "/api/auth/me":
                user = get_current_user(self.headers)
                if user:
                    self.send_json({"user": user, "authenticated": True})
                else:
                    self.send_json({"user": None, "authenticated": False})
                return

            # Restaurant Settings & Operating Hours
            if path == "/api/admin/settings" or path == "/api/settings":
                settings = get_restaurant_settings(conn)
                self.send_json({"settings": settings})
                return

            # Categories
            if path == "/api/categories":
                cur.execute("SELECT * FROM categories ORDER BY sort_order ASC")
                cats = [dict(r) for r in cur.fetchall()]
                self.send_json({"categories": cats})
                return

            # Full Menu with Options
            if path == "/api/menu":
                cur.execute("SELECT * FROM categories ORDER BY sort_order ASC")
                categories = [dict(r) for r in cur.fetchall()]

                cur.execute("SELECT * FROM menu_items ORDER BY sort_order ASC")
                items = [dict(r) for r in cur.fetchall()]

                cur.execute("SELECT * FROM option_groups")
                groups = [dict(r) for r in cur.fetchall()]

                cur.execute("SELECT * FROM option_choices")
                choices = [dict(r) for r in cur.fetchall()]

                # Group choices under option_groups
                group_map = {}
                for g in groups:
                    g["choices"] = []
                    group_map[g["id"]] = g

                for c in choices:
                    if c["option_group_id"] in group_map:
                        group_map[c["option_group_id"]]["choices"].append(c)

                # Group options under menu_items
                item_map = {}
                for it in items:
                    it["dietary_tags"] = json.loads(it["dietary_tags"]) if it["dietary_tags"] else []
                    it["option_groups"] = []
                    item_map[it["id"]] = it

                for g in groups:
                    if g["menu_item_id"] in item_map:
                        item_map[g["menu_item_id"]]["option_groups"].append(g)

                # Nest items under categories
                cat_map = {c["id"]: c for c in categories}
                for c in categories:
                    c["items"] = []

                for it in items:
                    if it["category_id"] in cat_map:
                        cat_map[it["category_id"]]["items"].append(it)

                self.send_json({
                    "categories": categories,
                    "all_items": items
                })
                return

            # Saved Delivery Addresses
            if path == "/api/addresses":
                user_id = query.get("user_id", [None])[0]
                if not user_id:
                    cur_user = get_current_user(self.headers)
                    if cur_user:
                        user_id = cur_user["id"]
                    else:
                        user_id = 1  # default demo customer
                cur.execute("SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC", (user_id,))
                addresses = [dict(r) for r in cur.fetchall()]
                self.send_json({"addresses": addresses})
                return

            # Drivers List (for staff allocation)
            if path == "/api/drivers":
                cur.execute("""
                    SELECT u.id, u.name, u.phone, u.vehicle_type, u.is_active,
                           COUNT(CASE WHEN o.status IN ('ready_for_pickup', 'out_for_delivery') THEN 1 END) as active_orders_count
                    FROM users u
                    LEFT JOIN orders o ON o.driver_id = u.id AND o.status IN ('ready_for_pickup', 'out_for_delivery')
                    WHERE u.role = 'driver' AND u.is_active = 1
                    GROUP BY u.id
                """)
                drivers = [dict(r) for r in cur.fetchall()]
                self.send_json({"drivers": drivers})
                return

            # Users Management (Admin)
            if path == "/api/users":
                role_filter = query.get("role", [None])[0]
                if role_filter:
                    cur.execute("SELECT id, name, email, phone, role, auth_provider, vehicle_type, is_active, created_at FROM users WHERE role = ? ORDER BY id DESC", (role_filter,))
                else:
                    cur.execute("SELECT id, name, email, phone, role, auth_provider, vehicle_type, is_active, created_at FROM users ORDER BY id DESC")
                users = [dict(r) for r in cur.fetchall()]
                self.send_json({"users": users})
                return

            # Orders List
            if path == "/api/orders":
                user_id = query.get("customer_id", [None])[0]
                driver_id = query.get("driver_id", [None])[0]
                status_filter = query.get("status", [None])[0]

                sql = """
                    SELECT o.*, 
                           u.name as customer_name, u.phone as customer_phone,
                           d.name as driver_name, d.phone as driver_phone, d.vehicle_type as driver_vehicle
                    FROM orders o
                    LEFT JOIN users u ON o.customer_id = u.id
                    LEFT JOIN users d ON o.driver_id = d.id
                    WHERE 1=1
                """
                params = []

                if user_id:
                    sql += " AND o.customer_id = ?"
                    params.append(user_id)
                if driver_id:
                    sql += " AND o.driver_id = ?"
                    params.append(driver_id)
                if status_filter:
                    sql += " AND o.status = ?"
                    params.append(status_filter)

                sql += " ORDER BY o.id DESC"
                cur.execute(sql, params)
                orders = [dict(r) for r in cur.fetchall()]

                # Attach order items for each order
                for ord_obj in orders:
                    cur.execute("SELECT * FROM order_items WHERE order_id = ?", (ord_obj["id"],))
                    ord_obj["items"] = [dict(r) for r in cur.fetchall()]

                self.send_json({"orders": orders})
                return

            # Single Order Detail
            if path.startswith("/api/orders/"):
                ord_id = path.split("/")[3]
                cur.execute("""
                    SELECT o.*, 
                           u.name as customer_name, u.phone as customer_phone,
                           d.name as driver_name, d.phone as driver_phone, d.vehicle_type as driver_vehicle
                    FROM orders o
                    LEFT JOIN users u ON o.customer_id = u.id
                    LEFT JOIN users d ON o.driver_id = d.id
                    WHERE o.id = ? OR o.order_number = ?
                """, (ord_id, ord_id))
                row = cur.fetchone()
                if not row:
                    self.send_error_json("Order not found", 404)
                    return
                order_data = dict(row)
                cur.execute("SELECT * FROM order_items WHERE order_id = ?", (order_data["id"],))
                order_data["items"] = [dict(r) for r in cur.fetchall()]
                cur.execute("SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY id ASC", (order_data["id"],))
                order_data["status_logs"] = [dict(r) for r in cur.fetchall()]
                self.send_json({"order": order_data})
                return

            # Support Tickets
            if path == "/api/support/tickets":
                customer_id = query.get("customer_id", [None])[0]
                status_filter = query.get("status", [None])[0]

                sql = """
                    SELECT t.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                           o.order_number, o.status as order_status,
                           (SELECT message FROM support_messages WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) as last_message,
                           (SELECT created_at FROM support_messages WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) as last_message_time
                    FROM support_tickets t
                    JOIN users u ON t.customer_id = u.id
                    LEFT JOIN orders o ON t.order_id = o.id
                    WHERE 1=1
                """
                params = []
                if customer_id:
                    sql += " AND t.customer_id = ?"
                    params.append(customer_id)
                if status_filter:
                    sql += " AND t.status = ?"
                    params.append(status_filter)
                sql += " ORDER BY t.updated_at DESC, t.id DESC"

                cur.execute(sql, params)
                tickets = [dict(r) for r in cur.fetchall()]
                self.send_json({"tickets": tickets})
                return

            # Ticket Messages
            if path.startswith("/api/support/tickets/") and path.endswith("/messages"):
                parts = path.split("/")
                ticket_id = parts[4]
                cur.execute("SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id ASC", (ticket_id,))
                messages = [dict(r) for r in cur.fetchall()]
                self.send_json({"messages": messages})
                return

            # Business Analytics & Reporting (Admin)
            if path == "/api/admin/analytics":
                period = query.get("period", ["all"])[0]  # today, week, month, all
                self.handle_analytics(cur, period)
                return

            self.send_error_json(f"Endpoint {path} not found", 404)

        finally:
            conn.close()

    # -------------------------------------------------------------
    # Analytics Calculation
    # -------------------------------------------------------------
    def handle_analytics(self, cur, period):
        time_clause = ""
        params = []
        now = datetime.now()

        if period == "today":
            time_clause = " AND date(placed_at) = date('now')"
        elif period == "week":
            time_clause = " AND placed_at >= datetime('now', '-7 days')"
        elif period == "month":
            time_clause = " AND placed_at >= datetime('now', '-30 days')"

        # 1. High-level KPIs
        cur.execute(f"""
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(CASE WHEN status != 'cancelled' AND status != 'rejected' THEN total ELSE 0 END), 0) as total_revenue,
                COALESCE(AVG(CASE WHEN status != 'cancelled' AND status != 'rejected' THEN total ELSE NULL END), 0) as avg_order_value,
                SUM(CASE WHEN fulfillment_type = 'delivery' THEN 1 ELSE 0 END) as delivery_count,
                SUM(CASE WHEN fulfillment_type = 'pickup' THEN 1 ELSE 0 END) as pickup_count,
                SUM(CASE WHEN status = 'delivered' OR status = 'ready_for_pickup' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_orders
            FROM orders
            WHERE 1=1 {time_clause}
        """, params)
        kpis = dict(cur.fetchone())

        # 2. Revenue Breakdown by Payment Method
        cur.execute(f"""
            SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as revenue
            FROM orders
            WHERE status NOT IN ('cancelled', 'rejected') {time_clause}
            GROUP BY payment_method
        """, params)
        payment_breakdown = [dict(r) for r in cur.fetchall()]

        # 3. Top-Selling Items
        cur.execute(f"""
            SELECT oi.item_name, SUM(oi.quantity) as total_sold, SUM(oi.total_price) as total_revenue
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status NOT IN ('cancelled', 'rejected') {time_clause}
            GROUP BY oi.item_name
            ORDER BY total_sold DESC
            LIMIT 6
        """, params)
        top_items = [dict(r) for r in cur.fetchall()]

        # 4. Hourly Distribution (Peak Ordering Hours)
        cur.execute(f"""
            SELECT strftime('%H:00', placed_at) as hour, COUNT(*) as order_count, SUM(total) as revenue
            FROM orders
            WHERE 1=1 {time_clause}
            GROUP BY hour
            ORDER BY hour ASC
        """, params)
        hourly_distribution = [dict(r) for r in cur.fetchall()]

        # 5. Orders by Status
        cur.execute(f"""
            SELECT status, COUNT(*) as count
            FROM orders
            WHERE 1=1 {time_clause}
            GROUP BY status
        """, params)
        status_distribution = [dict(r) for r in cur.fetchall()]

        self.send_json({
            "kpis": kpis,
            "period": period,
            "payment_breakdown": payment_breakdown,
            "top_items": top_items,
            "hourly_distribution": hourly_distribution,
            "status_distribution": status_distribution
        })

    # -------------------------------------------------------------
    # POST / PUT Handlers
    # -------------------------------------------------------------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_json_body()

        conn = get_db()
        cur = conn.cursor()

        try:
            # 1. Authentication Endpoints
            if path == "/api/auth/login":
                # Supports credentials, Google OAuth simulation, or Phone OTP simulation
                auth_type = body.get("type", "credentials")  # 'credentials', 'google', 'phone_otp', 'switch_role'

                if auth_type == "switch_role":
                    role = body.get("role", "customer")
                    cur.execute("SELECT * FROM users WHERE role = ? AND is_active = 1 ORDER BY id ASC LIMIT 1", (role,))
                    user = cur.fetchone()
                    if not user:
                        self.send_error_json("No active user found for role", 404)
                        return
                    user_dict = dict(user)
                    user_dict.pop("password_hash", None)
                    token = create_session(user_dict)
                    self.send_json({"user": user_dict, "token": token, "success": True})
                    return

                elif auth_type == "google":
                    email = body.get("email", "google.user@example.com")
                    name = body.get("name", "Google Explorer")
                    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
                    user = cur.fetchone()
                    if not user:
                        cur.execute("""
                            INSERT INTO users (name, email, phone, role, auth_provider, is_active)
                            VALUES (?, ?, ?, 'customer', 'google', 1)
                        """, (name, email, body.get("phone", "+15550001111")))
                        conn.commit()
                        user_id = cur.lastrowid
                        cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
                        user = cur.fetchone()

                    user_dict = dict(user)
                    user_dict.pop("password_hash", None)
                    token = create_session(user_dict)
                    self.send_json({"user": user_dict, "token": token, "success": True})
                    return

                elif auth_type == "phone_otp":
                    phone = body.get("phone")
                    otp = body.get("otp", "123456")
                    # Any valid 6-digit OTP succeeds for demo
                    if not phone or len(str(otp)) != 6:
                        self.send_error_json("Invalid phone number or 6-digit verification code", 400)
                        return
                    cur.execute("SELECT * FROM users WHERE phone = ?", (phone,))
                    user = cur.fetchone()
                    if not user:
                        name = body.get("name", f"Customer {phone[-4:]}")
                        cur.execute("""
                            INSERT INTO users (name, email, phone, role, auth_provider, is_active)
                            VALUES (?, ?, ?, 'customer', 'phone_otp', 1)
                        """, (name, f"user_{phone.replace('+', '')}@mobile.app", phone))
                        conn.commit()
                        user_id = cur.lastrowid
                        cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
                        user = cur.fetchone()

                    user_dict = dict(user)
                    user_dict.pop("password_hash", None)
                    token = create_session(user_dict)
                    self.send_json({"user": user_dict, "token": token, "success": True})
                    return

                else:
                    email = body.get("email")
                    password = body.get("password")
                    cur.execute("SELECT * FROM users WHERE (email = ? OR phone = ?) AND is_active = 1", (email, email))
                    user = cur.fetchone()
                    if not user or user["password_hash"] != hash_pw(password or ""):
                        self.send_error_json("Invalid email or password", 401)
                        return
                    user_dict = dict(user)
                    user_dict.pop("password_hash", None)
                    token = create_session(user_dict)
                    self.send_json({"user": user_dict, "token": token, "success": True})
                    return

            # 2. Geofence Distance Validation
            if path == "/api/delivery/validate-distance":
                settings = get_restaurant_settings(conn)
                rest_lat = float(settings.get("restaurant_lat", 51.5074))
                rest_lng = float(settings.get("restaurant_lng", -0.1278))
                max_radius = float(settings.get("delivery_radius_km", 3.0))

                user_lat = body.get("lat")
                user_lng = body.get("lng")
                if user_lat is None or user_lng is None:
                    self.send_error_json("Latitude and Longitude are required for geofence validation", 400)
                    return

                dist = haversine_km(rest_lat, rest_lng, float(user_lat), float(user_lng))
                is_eligible = (dist <= max_radius)

                self.send_json({
                    "distance_km": dist,
                    "max_radius_km": max_radius,
                    "eligible": is_eligible,
                    "message": f"Address is {dist} km from restaurant." + (
                        " Within 3 km delivery zone!" if is_eligible
                        else f" Delivery unavailable: Exceeds maximum {max_radius} km boundary. Please select Takeaway/Pickup instead."
                    )
                })
                return

            # 3. Add Saved User Address
            if path == "/api/addresses":
                user_id = body.get("user_id", 1)
                label = body.get("label", "Home")
                street = body.get("street_address", "").strip()
                lat = float(body.get("lat", 51.5140))
                lng = float(body.get("lng", -0.1180))
                notes = body.get("delivery_notes", "")
                is_def = 1 if body.get("is_default") else 0

                settings = get_restaurant_settings(conn)
                rest_lat = float(settings.get("restaurant_lat", 51.5074))
                rest_lng = float(settings.get("restaurant_lng", -0.1278))
                dist = haversine_km(rest_lat, rest_lng, lat, lng)

                if is_def:
                    cur.execute("UPDATE user_addresses SET is_default = 0 WHERE user_id = ?", (user_id,))

                cur.execute("""
                    INSERT INTO user_addresses (user_id, label, street_address, lat, lng, distance_km, delivery_notes, is_default)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, label, street, lat, lng, dist, notes, is_def))
                conn.commit()
                new_id = cur.lastrowid
                cur.execute("SELECT * FROM user_addresses WHERE id = ?", (new_id,))
                self.send_json({"address": dict(cur.fetchone()), "success": True})
                return

            # 4. Place Order
            if path == "/api/orders":
                settings = get_restaurant_settings(conn)
                if not settings.get("is_store_open", True):
                    self.send_error_json("Restaurant is currently closed: " + settings.get("store_status_message", "Not accepting orders at this time."), 400)
                    return

                cust_id = body.get("customer_id", 1)
                fulfillment_type = body.get("fulfillment_type", "pickup")  # 'pickup' or 'delivery'
                payment_method = body.get("payment_method", "online_card")
                items = body.get("items", [])

                if not items:
                    self.send_error_json("Order must contain at least one item", 400)
                    return

                delivery_address = body.get("delivery_address")
                delivery_lat = body.get("delivery_lat")
                delivery_lng = body.get("delivery_lng")
                delivery_notes = body.get("delivery_notes", "")
                dist_km = 0.0
                delivery_fee = 0.0

                if fulfillment_type == "delivery":
                    if delivery_lat is None or delivery_lng is None or not delivery_address:
                        self.send_error_json("Delivery address and coordinates are required", 400)
                        return

                    rest_lat = float(settings.get("restaurant_lat", 51.5074))
                    rest_lng = float(settings.get("restaurant_lng", -0.1278))
                    max_radius = float(settings.get("delivery_radius_km", 3.0))
                    dist_km = haversine_km(rest_lat, rest_lng, float(delivery_lat), float(delivery_lng))

                    # Strict enforcement of 3 km geofence limit!
                    if dist_km > max_radius:
                        self.send_error_json(f"Delivery address is {dist_km} km away, which strictly exceeds the restaurant's {max_radius} km delivery radius. Please choose Takeaway/Pickup.", 400)
                        return

                    delivery_fee = float(settings.get("delivery_fee", 2.99))

                # Calculate item subtotal
                subtotal = 0.0
                order_items_to_insert = []

                for item in items:
                    m_id = item.get("menu_item_id")
                    cur.execute("SELECT * FROM menu_items WHERE id = ?", (m_id,))
                    m_row = cur.fetchone()
                    if not m_row:
                        self.send_error_json(f"Item #{m_id} not found", 400)
                        return
                    if not m_row["is_available"]:
                        self.send_error_json(f"'{m_row['name']}' is currently Sold Out / Out of Stock", 400)
                        return

                    unit_price = float(m_row["price"])
                    custom_sum = item.get("customization_summary", "")
                    add_on_price = float(item.get("options_extra_price", 0.0))
                    final_unit_price = round(unit_price + add_on_price, 2)
                    qty = int(item.get("quantity", 1))
                    item_total = round(final_unit_price * qty, 2)
                    subtotal += item_total

                    order_items_to_insert.append({
                        "menu_item_id": m_id,
                        "item_name": m_row["name"],
                        "unit_price": final_unit_price,
                        "quantity": qty,
                        "special_notes": item.get("special_notes", ""),
                        "customization_summary": custom_sum,
                        "total_price": item_total
                    })

                subtotal = round(subtotal, 2)
                tax_rate = float(settings.get("tax_rate", 0.08))
                tax = round(subtotal * tax_rate, 2)
                total = round(subtotal + tax + delivery_fee, 2)

                # Payment status
                payment_status = "paid" if payment_method in ("online_card", "online_wallet") else "pending_offline"

                # Generate clean unique order number
                cur.execute("SELECT COUNT(*) FROM orders")
                count = cur.fetchone()[0] + 1001
                order_number = f"ORD-{count}"

                cur.execute("""
                    INSERT INTO orders (
                        order_number, customer_id, fulfillment_type, status, payment_method, payment_status,
                        delivery_address, delivery_lat, delivery_lng, delivery_distance_km, delivery_notes,
                        subtotal, delivery_fee, tax, total, placed_at
                    ) VALUES (?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    order_number, cust_id, fulfillment_type, payment_method, payment_status,
                    delivery_address, delivery_lat, delivery_lng, dist_km, delivery_notes,
                    subtotal, delivery_fee, tax, total
                ))
                order_id = cur.lastrowid

                # Insert items
                for oi in order_items_to_insert:
                    cur.execute("""
                        INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (order_id, oi["menu_item_id"], oi["item_name"], oi["unit_price"], oi["quantity"], oi["special_notes"], oi["customization_summary"], oi["total_price"]))

                # Status log
                cur.execute("""
                    INSERT INTO order_status_logs (order_id, status, note)
                    VALUES (?, 'placed', 'Order placed by customer.')
                """, (order_id,))

                conn.commit()

                # Fetch full created order
                cur.execute("""
                    SELECT o.*, u.name as customer_name, u.phone as customer_phone
                    FROM orders o
                    JOIN users u ON o.customer_id = u.id
                    WHERE o.id = ?
                """, (order_id,))
                new_order = dict(cur.fetchone())
                new_order["items"] = order_items_to_insert

                # Broadcast live event to Kitchen Staff and others!
                sse_broadcaster.broadcast("order_created", {
                    "order": new_order,
                    "alert_sound": True,
                    "message": f"New {fulfillment_type.upper()} order #{order_number} received!"
                })

                self.send_json({"order": new_order, "success": True})
                return

            # 5. Kitchen Order Acceptance
            if path.startswith("/api/orders/") and path.endswith("/accept"):
                order_id = path.split("/")[3]
                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                ord_row = cur.fetchone()
                if not ord_row:
                    self.send_error_json("Order not found", 404)
                    return
                if ord_row["status"] != "placed":
                    self.send_error_json(f"Cannot accept order in status: {ord_row['status']}", 400)
                    return

                cur.execute("""
                    UPDATE orders 
                    SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (order_id,))
                cur.execute("""
                    INSERT INTO order_status_logs (order_id, status, note)
                    VALUES (?, 'accepted', 'Kitchen accepted order.')
                """, (order_id,))
                conn.commit()

                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                updated_ord = dict(cur.fetchone())

                sse_broadcaster.broadcast("order_updated", {
                    "order": updated_ord,
                    "status": "accepted",
                    "message": f"Order #{updated_ord['order_number']} has been accepted by the kitchen!"
                })
                self.send_json({"order": updated_ord, "success": True})
                return

            # 6. Kitchen Order Rejection
            if path.startswith("/api/orders/") and path.endswith("/reject"):
                order_id = path.split("/")[3]
                reason = body.get("reason", "Kitchen at capacity or ingredient unavailable")
                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                ord_row = cur.fetchone()
                if not ord_row:
                    self.send_error_json("Order not found", 404)
                    return

                cur.execute("""
                    UPDATE orders 
                    SET status = 'rejected', rejection_reason = ?
                    WHERE id = ?
                """, (reason, order_id))
                cur.execute("""
                    INSERT INTO order_status_logs (order_id, status, note)
                    VALUES (?, 'rejected', ?)
                """, (order_id, f"Rejected by kitchen: {reason}"))
                conn.commit()

                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                updated_ord = dict(cur.fetchone())

                sse_broadcaster.broadcast("order_updated", {
                    "order": updated_ord,
                    "status": "rejected",
                    "message": f"Order #{updated_ord['order_number']} was rejected: {reason}"
                })
                self.send_json({"order": updated_ord, "success": True})
                return

            # 7. Kitchen Status Transition / Driver Status Transition
            if path.startswith("/api/orders/") and path.endswith("/status"):
                order_id = path.split("/")[3]
                new_status = body.get("status")
                note = body.get("note", "")

                allowed_statuses = ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled']
                if new_status not in allowed_statuses:
                    self.send_error_json(f"Invalid status: {new_status}", 400)
                    return

                cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                ord_row = cur.fetchone()
                if not ord_row:
                    self.send_error_json("Order not found", 404)
                    return

                time_col = None
                if new_status == 'preparing':
                    time_col = "prepared_at = CURRENT_TIMESTAMP"
                elif new_status == 'ready_for_pickup':
                    time_col = "prepared_at = CURRENT_TIMESTAMP"
                elif new_status == 'out_for_delivery':
                    time_col = "dispatched_at = CURRENT_TIMESTAMP"
                elif new_status == 'delivered':
                    time_col = "delivered_at = CURRENT_TIMESTAMP, payment_status = 'paid'"

                if time_col:
                    cur.execute(f"UPDATE orders SET status = ?, {time_col} WHERE id = ?", (new_status, order_id))
                else:
                    cur.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))

                cur.execute("""
                    INSERT INTO order_status_logs (order_id, status, note)
                    VALUES (?, ?, ?)
                """, (order_id, new_status, note or f"Status changed to {new_status}"))
                conn.commit()

                cur.execute("""
                    SELECT o.*, u.name as customer_name, u.phone as customer_phone,
                           d.name as driver_name, d.phone as driver_phone
                    FROM orders o
                    LEFT JOIN users u ON o.customer_id = u.id
                    LEFT JOIN users d ON o.driver_id = d.id
                    WHERE o.id = ?
                """, (order_id,))
                updated_ord = dict(cur.fetchone())

                sse_broadcaster.broadcast("order_updated", {
                    "order": updated_ord,
                    "status": new_status,
                    "message": f"Order #{updated_ord['order_number']} is now {new_status.replace('_', ' ').title()}!"
                })
                self.send_json({"order": updated_ord, "success": True})
                return

            # 8. Assign Driver to Order (Kitchen / Admin)
            if path.startswith("/api/orders/") and path.endswith("/assign-driver"):
                order_id = path.split("/")[3]
                driver_id = body.get("driver_id")
                cur.execute("SELECT * FROM users WHERE id = ? AND role = 'driver'", (driver_id,))
                driver = cur.fetchone()
                if not driver:
                    self.send_error_json("Valid driver must be selected", 400)
                    return

                cur.execute("UPDATE orders SET driver_id = ? WHERE id = ?", (driver_id, order_id))
                cur.execute("""
                    INSERT INTO order_status_logs (order_id, status, note)
                    VALUES (?, (SELECT status FROM orders WHERE id = ?), ?)
                """, (order_id, order_id, f"Assigned to driver: {driver['name']}"))
                conn.commit()

                cur.execute("""
                    SELECT o.*, u.name as customer_name, u.phone as customer_phone,
                           d.name as driver_name, d.phone as driver_phone, d.vehicle_type as driver_vehicle
                    FROM orders o
                    LEFT JOIN users u ON o.customer_id = u.id
                    LEFT JOIN users d ON o.driver_id = d.id
                    WHERE o.id = ?
                """, (order_id,))
                updated_ord = dict(cur.fetchone())

                sse_broadcaster.broadcast("order_updated", {
                    "order": updated_ord,
                    "status": updated_ord["status"],
                    "message": f"Order #{updated_ord['order_number']} assigned to {driver['name']}!"
                })
                self.send_json({"order": updated_ord, "success": True})
                return

            # 9. Dynamic Inventory Toggling (Kitchen Staff)
            if path.startswith("/api/menu/items/") and path.endswith("/toggle"):
                item_id = path.split("/")[4]
                cur.execute("SELECT * FROM menu_items WHERE id = ?", (item_id,))
                item = cur.fetchone()
                if not item:
                    self.send_error_json("Item not found", 404)
                    return
                new_state = 0 if item["is_available"] == 1 else 1
                cur.execute("UPDATE menu_items SET is_available = ? WHERE id = ?", (new_state, item_id))
                conn.commit()

                sse_broadcaster.broadcast("inventory_updated", {
                    "item_id": item_id,
                    "item_name": item["name"],
                    "is_available": (new_state == 1),
                    "message": f"'{item['name']}' is now {'In Stock' if new_state == 1 else 'Sold Out'}!"
                })
                self.send_json({"item_id": item_id, "is_available": (new_state == 1), "success": True})
                return

            # 10. Option Choice Availability Toggle
            if path.startswith("/api/menu/options/") and path.endswith("/toggle"):
                opt_id = path.split("/")[4]
                cur.execute("SELECT * FROM option_choices WHERE id = ?", (opt_id,))
                opt = cur.fetchone()
                if not opt:
                    self.send_error_json("Option choice not found", 404)
                    return
                new_state = 0 if opt["is_available"] == 1 else 1
                cur.execute("UPDATE option_choices SET is_available = ? WHERE id = ?", (new_state, opt_id))
                conn.commit()

                sse_broadcaster.broadcast("inventory_updated", {
                    "option_choice_id": opt_id,
                    "name": opt["name"],
                    "is_available": (new_state == 1),
                    "message": f"Option '{opt['name']}' is now {'Available' if new_state == 1 else 'Unavailable'}!"
                })
                self.send_json({"option_id": opt_id, "is_available": (new_state == 1), "success": True})
                return

            # 11. Restaurant Operating Hours & Store Status (Admin)
            if path == "/api/admin/settings":
                for key, val in body.items():
                    if isinstance(val, (dict, list)):
                        str_val = json.dumps(val)
                    elif isinstance(val, bool):
                        str_val = "true" if val else "false"
                    else:
                        str_val = str(val)
                    cur.execute("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES (?, ?)", (key, str_val))
                conn.commit()

                settings = get_restaurant_settings(conn)
                sse_broadcaster.broadcast("store_status_updated", {
                    "settings": settings,
                    "message": "Restaurant operating status updated."
                })
                self.send_json({"settings": settings, "success": True})
                return

            # 12. Create / Update User Accounts (Admin)
            if path == "/api/users":
                name = body.get("name")
                email = body.get("email")
                phone = body.get("phone")
                role = body.get("role", "staff")
                password = body.get("password", "password123")
                vehicle = body.get("vehicle_type", "")

                if not name or not email:
                    self.send_error_json("Name and email are required", 400)
                    return

                cur.execute("""
                    INSERT INTO users (name, email, phone, password_hash, role, vehicle_type, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, 1)
                """, (name, email, phone, hash_pw(password), role, vehicle))
                conn.commit()
                new_uid = cur.lastrowid
                cur.execute("SELECT id, name, email, phone, role, vehicle_type, is_active, created_at FROM users WHERE id = ?", (new_uid,))
                self.send_json({"user": dict(cur.fetchone()), "success": True})
                return

            if path.startswith("/api/users/") and path.endswith("/toggle"):
                user_id = path.split("/")[3]
                cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
                user = cur.fetchone()
                if not user:
                    self.send_error_json("User not found", 404)
                    return
                new_act = 0 if user["is_active"] == 1 else 1
                cur.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_act, user_id))
                conn.commit()
                self.send_json({"user_id": user_id, "is_active": new_act, "success": True})
                return

            # 13. Support Desk: Create Ticket
            if path == "/api/support/tickets":
                customer_id = body.get("customer_id", 1)
                order_id = body.get("order_id")
                subject = body.get("subject", "Order question")
                first_message = body.get("message", "")

                cur.execute("SELECT COUNT(*) FROM support_tickets")
                t_num = f"TCK-{cur.fetchone()[0] + 501}"

                cur.execute("""
                    INSERT INTO support_tickets (ticket_number, customer_id, order_id, subject, status)
                    VALUES (?, ?, ?, ?, 'open')
                """, (t_num, customer_id, order_id, subject))
                t_id = cur.lastrowid

                # First message
                cur.execute("SELECT name, role FROM users WHERE id = ?", (customer_id,))
                u = cur.fetchone()
                sender_name = u["name"] if u else "Customer"
                sender_role = u["role"] if u else "customer"

                cur.execute("""
                    INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message)
                    VALUES (?, ?, ?, ?, ?)
                """, (t_id, customer_id, sender_role, sender_name, first_message))
                conn.commit()

                cur.execute("SELECT * FROM support_tickets WHERE id = ?", (t_id,))
                created_ticket = dict(cur.fetchone())

                sse_broadcaster.broadcast("support_ticket_created", {
                    "ticket": created_ticket,
                    "message": f"New support ticket {t_num} from {sender_name}: {subject}"
                })
                self.send_json({"ticket": created_ticket, "success": True})
                return

            # 14. Support Desk: Send Message
            if path.startswith("/api/support/tickets/") and path.endswith("/messages"):
                ticket_id = path.split("/")[4]
                sender_id = body.get("sender_id", 1)
                message_text = body.get("message", "").strip()

                if not message_text:
                    self.send_error_json("Message cannot be empty", 400)
                    return

                cur.execute("SELECT name, role FROM users WHERE id = ?", (sender_id,))
                u = cur.fetchone()
                sender_name = u["name"] if u else "Staff"
                sender_role = u["role"] if u else "staff"

                cur.execute("""
                    INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message)
                    VALUES (?, ?, ?, ?, ?)
                """, (ticket_id, sender_id, sender_role, sender_name, message_text))
                new_msg_id = cur.lastrowid

                # Update ticket timestamp and set to in_progress if admin replied
                if sender_role in ('staff', 'admin'):
                    cur.execute("UPDATE support_tickets SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (ticket_id,))
                else:
                    cur.execute("UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (ticket_id,))
                conn.commit()

                cur.execute("SELECT * FROM support_messages WHERE id = ?", (new_msg_id,))
                msg_row = dict(cur.fetchone())

                sse_broadcaster.broadcast("support_message", {
                    "ticket_id": ticket_id,
                    "message": msg_row
                })
                self.send_json({"message": msg_row, "success": True})
                return

            # 15. Support Desk: Resolve Ticket
            if path.startswith("/api/support/tickets/") and path.endswith("/resolve"):
                ticket_id = path.split("/")[4]
                cur.execute("UPDATE support_tickets SET status = 'resolved', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (ticket_id,))
                conn.commit()
                sse_broadcaster.broadcast("support_ticket_resolved", {"ticket_id": ticket_id})
                self.send_json({"ticket_id": ticket_id, "status": "resolved", "success": True})
                return

            self.send_error_json(f"POST route {path} not found", 404)

        finally:
            conn.close()

    # -------------------------------------------------------------
    # Static Files Handling
    # -------------------------------------------------------------
    def handle_static_files(self, path):
        if path == "/" or path == "":
            file_path = os.path.join(STATIC_DIR, "index.html")
        else:
            rel_path = path.lstrip("/")
            if rel_path.startswith("static/"):
                rel_path = rel_path[7:]
            file_path = os.path.join(STATIC_DIR, rel_path)

        file_path = os.path.abspath(file_path)
        if not file_path.startswith(STATIC_DIR) or not os.path.exists(file_path) or os.path.isdir(file_path):
            # Fallback to index.html for SPA routing
            index_path = os.path.join(STATIC_DIR, "index.html")
            if os.path.exists(index_path):
                self.serve_file(index_path, "text/html")
            else:
                self.send_error(404, "File Not Found")
            return

        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = "application/octet-stream"
        self.serve_file(file_path, mime_type)

    def serve_file(self, file_path, content_type):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8" if "text" in content_type or "javascript" in content_type or "json" in content_type else content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {str(e)}")

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def run_server(port=PORT):
    init_db()
    server = ThreadedHTTPServer(("0.0.0.0", port), RestaurantRequestHandler)
    print(f"================================================================")
    print(f" Food Restaurant Application Server Running at http://localhost:{port}")
    print(f" Real-time SSE Stream at http://localhost:{port}/api/events")
    print(f"================================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
        server.server_close()

if __name__ == "__main__":
    p = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run_server(p)
