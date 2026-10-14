"""
Comprehensive End-to-End Test Suite for Single-Restaurant Ordering & Delivery System.
Tests all PRD requirements across Customer, Kitchen, Driver, and Admin flows.
"""

import urllib.request
import urllib.parse
import json
import time
import threading
import unittest
import os
import server
from database import init_db, get_db

TEST_PORT = 8089

class RestaurantAppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.server_thread = threading.Thread(
            target=lambda: server.run_server(TEST_PORT),
            daemon=True
        )
        cls.server_thread.start()
        time.sleep(0.5)
        cls.base_url = f"http://127.0.0.1:{TEST_PORT}"

    def request(self, path, method="GET", data=None):
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
                raw = resp.read().decode("utf-8")
                try:
                    payload = json.loads(raw)
                except Exception:
                    payload = raw
                return status, payload
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8")
            try:
                payload = json.loads(raw)
            except Exception:
                payload = raw
            return e.code, payload

    # 1. Static Web Assets
    def test_01_static_files(self):
        status, html = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("Artisan Flame Grill", html)
        self.assertIn("Customer App", html)
        self.assertIn("Kitchen (KDS)", html)
        self.assertIn("Driver View", html)
        self.assertIn("Admin Portal", html)

    # 2. Menu & Categories
    def test_02_menu_and_categories(self):
        status, data = self.request("/api/categories")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(data["categories"]), 4)

        status, menu = self.request("/api/menu")
        self.assertEqual(status, 200)
        self.assertIn("all_items", menu)
        self.assertGreaterEqual(len(menu["all_items"]), 10)
        
        # Check customization options on Truffle burger
        burger = next((i for i in menu["all_items"] if "Truffle Smash" in i["name"]), None)
        self.assertIsNotNone(burger)
        self.assertGreater(len(burger["option_groups"]), 0)

    # 3. Geofencing 3 km Boundary
    def test_03_geofencing_validation(self):
        # 1.2 km away (Inside 3km boundary)
        status, res_in = self.request("/api/delivery/validate-distance", method="POST", data={
            "lat": 51.5140, "lng": -0.1180
        })
        self.assertEqual(status, 200)
        self.assertTrue(res_in["eligible"])
        self.assertLessEqual(res_in["distance_km"], 3.0)

        # 4.5 km away (Exceeds 3km boundary)
        status, res_out = self.request("/api/delivery/validate-distance", method="POST", data={
            "lat": 51.5450, "lng": -0.0800
        })
        self.assertEqual(status, 200)
        self.assertFalse(res_out["eligible"])
        self.assertGreater(res_out["distance_km"], 3.0)

    # 4. Order Placement - Strict Geofence Enforcement
    def test_04_order_placement_geofence_enforcement(self):
        # A) Order with delivery address outside 3km should fail!
        status, fail_res = self.request("/api/orders", method="POST", data={
            "customer_id": 1,
            "fulfillment_type": "delivery",
            "payment_method": "online_card",
            "delivery_address": "88 Northwood Crescent (Far)",
            "delivery_lat": 51.5450,
            "delivery_lng": -0.0800,
            "items": [{"menu_item_id": 1, "quantity": 1}]
        })
        self.assertEqual(status, 400)
        self.assertIn("strictly exceeds", fail_res["error"])

        # B) Order with delivery address within 3km succeeds!
        status, ok_res = self.request("/api/orders", method="POST", data={
            "customer_id": 1,
            "fulfillment_type": "delivery",
            "payment_method": "online_card",
            "delivery_address": "Flat 4B, 18 Camden Walk",
            "delivery_lat": 51.5140,
            "delivery_lng": -0.1180,
            "items": [
                {
                    "menu_item_id": 1,
                    "quantity": 2,
                    "options_extra_price": 2.00,
                    "customization_summary": "Spice: Medium | Add Bacon (+$2.00)"
                }
            ]
        })
        self.assertEqual(status, 200)
        self.assertTrue(ok_res["success"])
        order = ok_res["order"]
        self.assertEqual(order["status"], "placed")
        self.assertGreater(order["total"], 0)
        self.__class__.placed_order_id = order["id"]

    # 5. Kitchen Workflow (Accept, Preparing, Ready, Driver Allocation)
    def test_05_kitchen_workflow(self):
        order_id = self.__class__.placed_order_id

        # Accept
        status, res = self.request(f"/api/orders/{order_id}/accept", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["status"], "accepted")

        # Start cooking (preparing)
        status, res = self.request(f"/api/orders/{order_id}/status", method="POST", data={"status": "preparing"})
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["status"], "preparing")

        # Mark ready for dispatch
        status, res = self.request(f"/api/orders/{order_id}/status", method="POST", data={"status": "ready_for_pickup"})
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["status"], "ready_for_pickup")

        # Assign driver (Alex Vance, id: 4)
        status, res = self.request(f"/api/orders/{order_id}/assign-driver", method="POST", data={"driver_id": 4})
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["driver_id"], 4)

    # 6. Driver Operations (Out for Delivery -> Delivered)
    def test_06_driver_operations(self):
        order_id = self.__class__.placed_order_id

        # Out for delivery
        status, res = self.request(f"/api/orders/{order_id}/status", method="POST", data={"status": "out_for_delivery"})
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["status"], "out_for_delivery")

        # Delivered
        status, res = self.request(f"/api/orders/{order_id}/status", method="POST", data={"status": "delivered"})
        self.assertEqual(status, 200)
        self.assertEqual(res["order"]["status"], "delivered")
        self.assertEqual(res["order"]["payment_status"], "paid")

    # 7. Dynamic Inventory Out-of-Stock Toggling
    def test_07_inventory_toggle(self):
        status, res = self.request("/api/menu/items/1/toggle", method="POST")
        self.assertEqual(status, 200)
        self.assertFalse(res["is_available"])

        # Try placing an order for the sold out item
        status, fail_res = self.request("/api/orders", method="POST", data={
            "customer_id": 1,
            "fulfillment_type": "pickup",
            "items": [{"menu_item_id": 1, "quantity": 1}]
        })
        self.assertEqual(status, 400)
        self.assertIn("Out of Stock", fail_res["error"])

        # Toggle back to In Stock
        status, res = self.request("/api/menu/items/1/toggle", method="POST")
        self.assertEqual(status, 200)
        self.assertTrue(res["is_available"])

    # 8. Business Analytics & Admin Settings
    def test_08_analytics_and_settings(self):
        status, analytics = self.request("/api/admin/analytics?period=all")
        self.assertEqual(status, 200)
        self.assertIn("kpis", analytics)
        self.assertGreater(analytics["kpis"]["total_orders"], 0)
        self.assertGreater(analytics["kpis"]["total_revenue"], 0)

        # Update emergency closed switch
        status, res = self.request("/api/admin/settings", method="POST", data={
            "is_store_open": True,
            "store_status_message": "Kitchen is busy and baking fresh pizzas!"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res["settings"]["is_store_open"])

    # 9. Support Desk & Live Chat
    def test_09_support_desk(self):
        # Create ticket
        status, res = self.request("/api/support/tickets", method="POST", data={
            "customer_id": 1,
            "order_id": self.__class__.placed_order_id,
            "subject": "Napkins and cutlery request",
            "message": "Please include extra napkins with my delivery."
        })
        self.assertEqual(status, 200)
        ticket_id = res["ticket"]["id"]

        # Staff reply
        status, res = self.request(f"/api/support/tickets/{ticket_id}/messages", method="POST", data={
            "sender_id": 3,
            "message": "Sure thing Sarah, adding compostable napkins and wooden cutlery now!"
        })
        self.assertEqual(status, 200)
        self.assertEqual(res["message"]["sender_name"], "Chef Marco Rossi")

        # Resolve ticket
        status, res = self.request(f"/api/support/tickets/{ticket_id}/resolve", method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(res["status"], "resolved")

if __name__ == "__main__":
    unittest.main()
