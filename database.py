"""
Database module for Single-Restaurant Ordering & Delivery System.
Manages SQLite schema, migrations, connection helper, and initial seed data.
"""

import sqlite3
import os
import json
import hashlib
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "restaurant.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL CHECK(role IN ('customer', 'kitchen', 'driver', 'admin')),
        auth_provider TEXT DEFAULT 'local',
        vehicle_type TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. User Saved Addresses Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        street_address TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        distance_km REAL NOT NULL,
        delivery_notes TEXT,
        is_default INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 3. Categories Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        icon TEXT DEFAULT '🍽️',
        sort_order INTEGER DEFAULT 0
    );
    """)

    # 4. Menu Items Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        image_url TEXT,
        badge TEXT,
        dietary_tags TEXT, -- JSON array of tags like ["Vegetarian", "Spicy"]
        is_available INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );
    """)

    # 5. Option Groups Table (e.g. Spice Level, Extra Toppings)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS option_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_item_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('single', 'multi')),
        required INTEGER DEFAULT 0,
        min_selection INTEGER DEFAULT 0,
        max_selection INTEGER DEFAULT 10,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
    );
    """)

    # 6. Option Choices Table (e.g. Mild, Medium, Hot, Bacon +$1.50)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS option_choices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        option_group_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price REAL DEFAULT 0.0,
        is_available INTEGER DEFAULT 1,
        FOREIGN KEY (option_group_id) REFERENCES option_groups(id) ON DELETE CASCADE
    );
    """)

    # 7. Orders Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN ('pickup', 'delivery')),
        status TEXT NOT NULL CHECK(status IN ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'rejected', 'cancelled')),
        payment_method TEXT NOT NULL CHECK(payment_method IN ('online_card', 'online_wallet', 'offline_cash', 'offline_card')),
        payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'pending_offline', 'failed')),
        delivery_address TEXT,
        delivery_lat REAL,
        delivery_lng REAL,
        delivery_distance_km REAL,
        delivery_notes TEXT,
        rejection_reason TEXT,
        subtotal REAL NOT NULL,
        delivery_fee REAL DEFAULT 0.0,
        tax REAL DEFAULT 0.0,
        total REAL NOT NULL,
        driver_id INTEGER,
        placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accepted_at DATETIME,
        prepared_at DATETIME,
        dispatched_at DATETIME,
        delivered_at DATETIME,
        FOREIGN KEY (customer_id) REFERENCES users(id),
        FOREIGN KEY (driver_id) REFERENCES users(id)
    );
    """)

    # 8. Order Items Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        unit_price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        special_notes TEXT,
        customization_summary TEXT, -- e.g. "Spice: Medium | Add Bacon (+$1.50)"
        total_price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    """)

    # 9. Order Status Logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS order_status_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    """)

    # 10. Support Tickets
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        order_id INTEGER,
        subject TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'resolved')) DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES users(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
    );
    """)

    # 11. Support Messages
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_role TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id)
    );
    """)

    # 12. Restaurant Settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS restaurant_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    conn.commit()
    seed_initial_data(conn)
    conn.close()

def seed_initial_data(conn):
    cursor = conn.cursor()

    # Check if already seeded
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] > 0:
        return

    print("Seeding database with initial restaurant data...")

    # Default Settings
    settings = {
        "restaurant_name": "Artisan Flame Grill & Kitchen",
        "restaurant_tagline": "Handcrafted burgers, stone-baked pizzas & fresh bowls",
        "restaurant_address": "42 Gourmet Way, Central Plaza",
        "restaurant_phone": "+1 (555) 234-5678",
        "restaurant_lat": "51.5074",
        "restaurant_lng": "-0.1278",
        "delivery_radius_km": "3.0",
        "delivery_fee": "2.99",
        "tax_rate": "0.08",
        "is_store_open": "true",
        "store_status_message": "Kitchen is open and firing up delicious meals!",
        "operating_hours": json.dumps({
            "monday": {"open": "10:00", "close": "22:00", "isOpen": True},
            "tuesday": {"open": "10:00", "close": "22:00", "isOpen": True},
            "wednesday": {"open": "10:00", "close": "22:00", "isOpen": True},
            "thursday": {"open": "10:00", "close": "22:30", "isOpen": True},
            "friday": {"open": "10:00", "close": "23:30", "isOpen": True},
            "saturday": {"open": "10:00", "close": "23:30", "isOpen": True},
            "sunday": {"open": "11:00", "close": "21:30", "isOpen": True}
        })
    }
    for k, v in settings.items():
        cursor.execute("INSERT OR REPLACE INTO restaurant_settings (key, value) VALUES (?, ?)", (k, v))

    # Users: Customer, Kitchen Staff, Delivery Driver, Admin
    users = [
        ("Sarah Jenkins", "customer@example.com", "+15551234567", hash_pw("customer123"), "customer", "local", None, 1),
        ("David Miller", "david.m@example.com", "+15559876543", hash_pw("customer123"), "customer", "google", None, 1),
        ("Chef Marco Rossi", "kitchen@example.com", "+15552345678", hash_pw("kitchen123"), "kitchen", "local", None, 1),
        ("Alex 'Speedy' Vance", "driver@example.com", "+15553456789", hash_pw("driver123"), "driver", "local", "Electric E-Moped (Eco-Fast)", 1),
        ("Samira Chen", "driver2@example.com", "+15554567890", hash_pw("driver123"), "driver", "local", "Custom Delivery Scooter", 1),
        ("Eleanor Vance (GM)", "admin@example.com", "+15555678901", hash_pw("admin123"), "admin", "local", None, 1),
    ]
    cursor.executemany("""
    INSERT INTO users (name, email, phone, password_hash, role, auth_provider, vehicle_type, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, users)

    # Saved Addresses for Sarah (Customer #1)
    # Center is 51.5074, -0.1278
    # 1.2 km away: 51.5140, -0.1180 (Eligible)
    # 2.4 km away: 51.5220, -0.1050 (Eligible)
    # 4.5 km away: 51.5450, -0.0800 (Ineligible / Out of Zone)
    addresses = [
        (1, "Home", "Flat 4B, 18 Camden Walk", 51.5140, -0.1180, 1.2, "Buzz 402 on arrival. Leave by door.", 1),
        (1, "Work / Studio", "Tech Hub Suite 204, River Way", 51.5220, -0.1050, 2.4, "Reception desk drop-off.", 0),
        (1, "Parents House (Far)", "88 Northwood Crescent", 51.5450, -0.0800, 4.5, "Out of radius example address", 0),
    ]
    cursor.executemany("""
    INSERT INTO user_addresses (user_id, label, street_address, lat, lng, distance_km, delivery_notes, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, addresses)

    # Categories
    categories = [
        ("Signature Burgers", "burgers", "🍔", 1),
        ("Artisan Pizzas", "pizzas", "🍕", 2),
        ("Bowls & Greens", "bowls", "🥗", 3),
        ("Sides & Appetizers", "sides", "🍟", 4),
        ("Craft Drinks & Shakes", "drinks", "🥤", 5),
        ("Sweet Desserts", "desserts", "🍰", 6)
    ]
    cursor.executemany("""
    INSERT INTO categories (name, slug, icon, sort_order)
    VALUES (?, ?, ?, ?)
    """, categories)

    # Menu Items
    # (category_id, name, desc, price, img, badge, tags, is_available, sort_order)
    menu = [
        # Burgers
        (1, "Truffle Smash Double Burger", "Two 100% Angus patties smashed thin, black truffle mayo, double aged cheddar, caramelized shallots on brioche.", 14.99,
         "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80", "Chef Special", json.dumps(["Halal", "Bestseller"]), 1, 1),
        (1, "Smoky Bacon & BBQ Crunch", "Crispy hickory bacon, onion rings, house smoked BBQ glaze, melted Monterey Jack on toasted potato bun.", 13.95,
         "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=600&auto=format&fit=crop&q=80", "Popular", json.dumps(["Bestseller"]), 1, 2),
        (1, "The Green Harvest Veggie Burger", "Grilled spiced black bean & portobello patty, smashed avocado, pickled red onion, vegan herb aioli.", 12.50,
         "https://images.unsplash.com/photo-1520072959219-c595dc870360?w=600&auto=format&fit=crop&q=80", "Vegetarian", json.dumps(["Vegetarian", "Vegan Option"]), 1, 3),

        # Pizzas
        (2, "Neapolitan Margherita Di Bufala", "San Marzano D.O.P tomatoes, fresh buffalo mozzarella, fragrant wild basil, cold-pressed olive oil.", 13.50,
         "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=600&auto=format&fit=crop&q=80", "Authentic", json.dumps(["Vegetarian", "Bestseller"]), 1, 4),
        (2, "Diavola Hot Honey Pepperoni", "Spicy Calabrian salami, fresh fior di latte, hot wildflower honey drizzle, chili flakes.", 15.25,
         "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600&auto=format&fit=crop&q=80", "Hot & Spicy", json.dumps(["Spicy"]), 1, 5),
        (2, "Wild Mushroom & Truffle Bianco", "White cream base, sautéed chanterelles and cremini mushrooms, rosemary, fior di latte, white truffle oil.", 15.95,
         "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80", "Gourmet", json.dumps(["Vegetarian"]), 1, 6),

        # Bowls
        (3, "Mediterranean Glow Salmon Bowl", "Wild pan-seared salmon, lemon-herb quinoa, Persian cucumber, roasted chickpeas, whipped feta, kalamata olives.", 16.50,
         "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80", "Nutritious", json.dumps(["High Protein", "Gluten-Free"]), 1, 7),
        (3, "Spicy Sesame Chicken Crunch Bowl", "Crispy glazed chicken bites, warm jasmine rice, edamame, pickled carrots, purple cabbage, toasted sesame.", 14.25,
         "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80", "Spicy", json.dumps(["Spicy"]), 1, 8),

        # Sides
        (4, "Parmesan Truffle Rustic Fries", "Skin-on twice-cooked fries dusted with 24-month aged Parmigiano Reggiano, parsley, truffle dipping sauce.", 6.95,
         "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=600&auto=format&fit=crop&q=80", "Must Try", json.dumps(["Vegetarian"]), 1, 9),
        (4, "Crispy Korean BBQ Wings (6 pcs)", "Double-fried crispy chicken wings tossed in sticky sweet gochujang glaze, sesame seeds, spring onions.", 9.50,
         "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=600&auto=format&fit=crop&q=80", "Fiery", json.dumps(["Spicy"]), 1, 10),

        # Drinks
        (5, "Handcrafted Passionfruit Mango Lemonade", "Pressed Alphonso mango, fresh passionfruit pulp, Meyer lemon, sparkling mountain water.", 4.95,
         "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&auto=format&fit=crop&q=80", "Refreshing", json.dumps(["Cold", "Vegan"]), 1, 11),
        (5, "Salted Caramel Velvet Thickshake", "Madagascar vanilla gelato spun with artisan salted caramel, topped with whipped chantilly cream.", 6.50,
         "https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&auto=format&fit=crop&q=80", "Decadent", json.dumps(["Vegetarian"]), 1, 12),

        # Desserts
        (6, "Warm Molten Lava Chocolate Brownie", "Rich Belgian dark chocolate ganache molten center, paired with artisan clotted vanilla ice cream.", 7.50,
         "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&auto=format&fit=crop&q=80", "Sweet Treat", json.dumps(["Vegetarian"]), 1, 13),
        (6, "New York Caramel Biscoff Cheesecake", "Velvety baked cream cheese with crushed Lotus Biscoff crust, golden cookie butter drizzle.", 7.25,
         "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format&fit=crop&q=80", "Popular", json.dumps(["Vegetarian"]), 1, 14)
    ]
    cursor.executemany("""
    INSERT INTO menu_items (category_id, name, description, price, image_url, badge, dietary_tags, is_available, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, menu)

    # Option Groups & Choices for Customization
    # Truffle Smash Burger (item #1)
    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (1, 'Choose Spice Level', 'single', 1, 1, 1)
    """)
    og_spice1 = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_spice1, "Mild (Classic Gourmet)", 0.0, 1),
        (og_spice1, "Medium Zest", 0.0, 1),
        (og_spice1, "Extra Spicy Jalapeño Fire", 0.50, 1)
    ])

    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (1, 'Add Extra Toppings', 'multi', 0, 0, 5)
    """)
    og_top1 = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_top1, "Smoked Applewood Bacon", 2.00, 1),
        (og_top1, "Extra Melted Aged Cheddar", 1.50, 1),
        (og_top1, "Caramelized Balsamic Onions", 1.00, 1),
        (og_top1, "Fried Free-Range Egg", 1.50, 1),
        (og_top1, "Black Truffle Aioli Dip", 1.25, 1)
    ])

    # Diavola Pizza (item #5)
    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (5, 'Crust Style', 'single', 1, 1, 1)
    """)
    og_crust = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_crust, "Traditional Neapolitan Thin Crust", 0.0, 1),
        (og_crust, "Slow-Fermented Sourdough (+1.50)", 1.50, 1),
        (og_crust, "Garlic Herb Butter Stuffed Crust (+2.50)", 2.50, 1)
    ])

    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (5, 'Extra Pizza Toppings', 'multi', 0, 0, 4)
    """)
    og_piz_top = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_piz_top, "Extra Buffalo Mozzarella", 2.50, 1),
        (og_piz_top, "Double Hot Honey Drizzle", 1.00, 1),
        (og_piz_top, "Pickled Jalapeños", 1.00, 1),
        (og_piz_top, "Crispy Prosciutto Strips", 2.75, 1)
    ])

    # Korean Wings (item #10)
    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (10, 'Wings Sauce Glaze', 'single', 1, 1, 1)
    """)
    og_wing_sauce = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_wing_sauce, "Sweet Garlic & Honey Soy", 0.0, 1),
        (og_wing_sauce, "Fiery Gochujang (Original Heat)", 0.0, 1),
        (og_wing_sauce, "Ghost Chili Inferno (Extreme)", 0.75, 1)
    ])

    cursor.execute("""
    INSERT INTO option_groups (menu_item_id, name, type, required, min_selection, max_selection)
    VALUES (10, 'Side Dip Choice', 'single', 1, 1, 1)
    """)
    og_wing_dip = cursor.lastrowid
    cursor.executemany("""
    INSERT INTO option_choices (option_group_id, name, price, is_available) VALUES (?, ?, ?, ?)
    """, [
        (og_wing_dip, "Cool Buttermilk Ranch", 0.0, 1),
        (og_wing_dip, "Aged Blue Cheese Sauce", 0.0, 1),
        (og_wing_dip, "Yuzu Citrus Aioli", 0.50, 1)
    ])

    # Sample Historical Orders (to power analytics & kitchen queue right away)
    # Order 1: Delivered yesterday (Delivery)
    now = datetime.now()
    yesterday = now - timedelta(days=1)
    cursor.execute("""
    INSERT INTO orders (
        order_number, customer_id, fulfillment_type, status, payment_method, payment_status,
        delivery_address, delivery_lat, delivery_lng, delivery_distance_km, delivery_notes,
        subtotal, delivery_fee, tax, total, driver_id, placed_at, accepted_at, prepared_at, dispatched_at, delivered_at
    ) VALUES (
        'ORD-1001', 1, 'delivery', 'delivered', 'online_card', 'paid',
        'Flat 4B, 18 Camden Walk', 51.5140, -0.1180, 1.2, 'Please ring the doorbell twice.',
        28.44, 2.99, 2.28, 33.71, 4,
        ?, ?, ?, ?, ?
    )
    """, (
        (yesterday - timedelta(minutes=60)).strftime("%Y-%m-%d %H:%M:%S"),
        (yesterday - timedelta(minutes=55)).strftime("%Y-%m-%d %H:%M:%S"),
        (yesterday - timedelta(minutes=35)).strftime("%Y-%m-%d %H:%M:%S"),
        (yesterday - timedelta(minutes=25)).strftime("%Y-%m-%d %H:%M:%S"),
        (yesterday - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
    ))
    ord1_id = cursor.lastrowid
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 1, 'Truffle Smash Double Burger', 14.99, 1, 'Cut in half please', 'Spice: Medium Zest | Extra Bacon (+$2.00)', 16.99)
    """, (ord1_id,))
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 9, 'Parmesan Truffle Rustic Fries', 6.95, 1, 'Extra crispy', 'None', 6.95)
    """, (ord1_id,))
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 11, 'Handcrafted Passionfruit Mango Lemonade', 4.95, 1, 'Less ice', 'None', 4.95)
    """, (ord1_id,))

    # Order 2: In Kitchen Queue (Preparing right now!)
    cursor.execute("""
    INSERT INTO orders (
        order_number, customer_id, fulfillment_type, status, payment_method, payment_status,
        delivery_address, delivery_lat, delivery_lng, delivery_distance_km, delivery_notes,
        subtotal, delivery_fee, tax, total, driver_id, placed_at, accepted_at, prepared_at
    ) VALUES (
        'ORD-1002', 2, 'delivery', 'preparing', 'online_card', 'paid',
        'Tech Hub Suite 204, River Way', 51.5220, -0.1050, 2.4, 'Call on arrival.',
        24.75, 2.99, 1.98, 29.72, 4,
        ?, ?, NULL
    )
    """, (
        (now - timedelta(minutes=18)).strftime("%Y-%m-%d %H:%M:%S"),
        (now - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
    ))
    ord2_id = cursor.lastrowid
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 5, 'Diavola Hot Honey Pepperoni', 15.25, 1, 'Extra hot honey drizzle', 'Crust: Sourdough (+1.50) | Pickled Jalapeños (+$1.00)', 17.75)
    """, (ord2_id,))
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 10, 'Crispy Korean BBQ Wings (6 pcs)', 9.50, 1, 'Sauce on side', 'Glaze: Fiery Gochujang | Dip: Ranch', 9.50)
    """, (ord2_id,))

    # Order 3: Ready for pickup (Takeaway)
    cursor.execute("""
    INSERT INTO orders (
        order_number, customer_id, fulfillment_type, status, payment_method, payment_status,
        subtotal, delivery_fee, tax, total, placed_at, accepted_at, prepared_at
    ) VALUES (
        'ORD-1003', 1, 'pickup', 'ready_for_pickup', 'offline_cash', 'pending_offline',
        23.45, 0.0, 1.88, 25.33,
        ?, ?, ?
    )
    """, (
        (now - timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S"),
        (now - timedelta(minutes=25)).strftime("%Y-%m-%d %H:%M:%S"),
        (now - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
    ))
    ord3_id = cursor.lastrowid
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 7, 'Mediterranean Glow Salmon Bowl', 16.50, 1, 'Dressing on the side', 'None', 16.50)
    """, (ord3_id,))
    cursor.execute("""
    INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, special_notes, customization_summary, total_price)
    VALUES (?, 13, 'Warm Molten Lava Chocolate Brownie', 7.50, 1, 'Please heat well', 'None', 7.50)
    """, (ord3_id,))

    # Sample Support Ticket & Message
    cursor.execute("""
    INSERT INTO support_tickets (ticket_number, customer_id, order_id, subject, status, created_at, updated_at)
    VALUES ('TCK-501', 1, ?, 'Inquiry regarding sauce allergens', 'open', ?, ?)
    """, (ord1_id, (now - timedelta(minutes=40)).strftime("%Y-%m-%d %H:%M:%S"), now.strftime("%Y-%m-%d %H:%M:%S")))
    tck_id = cursor.lastrowid

    cursor.execute("""
    INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, created_at)
    VALUES (?, 1, 'customer', 'Sarah Jenkins', 'Hi! Could you confirm if the Truffle Aioli on yesterday''s burger has any dairy or mustard?', ?)
    """, (tck_id, (now - timedelta(minutes=40)).strftime("%Y-%m-%d %H:%M:%S")))

    cursor.execute("""
    INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, created_at)
    VALUES (?, 6, 'admin', 'Eleanor Vance (GM)', 'Hello Sarah! Our black truffle aioli contains egg yolks, fresh garlic, and sunflower oil, but is 100% mustard and dairy free. Hope you enjoyed the meal!', ?)
    """, (tck_id, (now - timedelta(minutes=25)).strftime("%Y-%m-%d %H:%M:%S")))

    conn.commit()
    print("Database seeding completed successfully.")

if __name__ == "__main__":
    init_db()
