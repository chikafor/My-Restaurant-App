/**
 * Main Application Orchestrator
 * State management, SSE real-time listener, role switcher, cart drawer,
 * checkout & payment handling, order tracking pipeline, and customer support chat.
 */

window.App = {
  currentUser: {
    id: 1,
    name: "Sarah Jenkins",
    email: "customer@example.com",
    role: "customer"
  },
  currentView: 'customer', // 'customer', 'kitchen', 'driver', 'admin'
  cart: [],
  restaurantSettings: {},
  sseSource: null,
  customerOrders: [],
  activeCustomerTicket: null,

  async init() {
    this.loadCartFromStorage();
    this.setupGlobalEvents();
    this.setupSSE();

    // Load initial settings
    await this.loadSettings();

    // Initialize all sub-views
    await Promise.all([
      CustomerView.init(),
      KitchenView.init(),
      DriverView.init(),
      AdminView.init()
    ]);

    await this.loadCustomerOrders();
    this.updateCartSummary();

    // Check store open banner
    this.updateStoreStatusBanner(this.restaurantSettings);
  },

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      this.restaurantSettings = data.settings || {};
    } catch (err) {
      console.error(err);
    }
  },

  setupGlobalEvents() {
    // Role switcher buttons
    document.querySelectorAll('[data-view-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-view-target');
        this.switchRole(target);
      });
    });

    // Cart Drawer Toggle
    const btnCart = document.getElementById('btn-open-cart');
    const btnCloseCart = document.getElementById('btn-close-cart');
    const cartDrawer = document.getElementById('cart-drawer');
    const cartOverlay = document.getElementById('cart-overlay');

    if (btnCart && cartDrawer) {
      btnCart.addEventListener('click', () => this.openCart());
    }
    if (btnCloseCart && cartDrawer) {
      btnCloseCart.addEventListener('click', () => this.closeCart());
    }
    if (cartOverlay) {
      cartOverlay.addEventListener('click', () => this.closeCart());
    }

    // Checkout button
    const btnCheckout = document.getElementById('btn-proceed-checkout');
    if (btnCheckout) {
      btnCheckout.addEventListener('click', () => this.processCheckout());
    }

    // Auth modal triggers
    const userBadge = document.getElementById('header-user-badge');
    const authModal = document.getElementById('auth-modal');
    const btnCloseAuth = document.getElementById('btn-close-auth-modal');
    if (userBadge && authModal) {
      userBadge.addEventListener('click', () => authModal.classList.add('active'));
    }
    if (btnCloseAuth && authModal) {
      btnCloseAuth.addEventListener('click', () => authModal.classList.remove('active'));
    }

    // Google Sign-In button simulation
    const btnGoogleAuth = document.getElementById('btn-auth-google');
    if (btnGoogleAuth) {
      btnGoogleAuth.addEventListener('click', () => this.simulateGoogleLogin());
    }

    // Phone OTP button simulation
    const btnOtpAuth = document.getElementById('btn-auth-otp');
    if (btnOtpAuth) {
      btnOtpAuth.addEventListener('click', () => this.simulatePhoneOtpLogin());
    }

    // Customer In-App Chat Modal
    const btnOpenChat = document.getElementById('btn-open-customer-chat');
    const chatModal = document.getElementById('customer-chat-modal');
    const btnCloseChat = document.getElementById('btn-close-customer-chat');
    const chatForm = document.getElementById('customer-chat-form');

    if (btnOpenChat && chatModal) {
      btnOpenChat.addEventListener('click', () => this.openCustomerChat());
    }
    if (btnCloseChat && chatModal) {
      btnCloseChat.addEventListener('click', () => chatModal.classList.remove('active'));
    }
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendCustomerChatMessage();
      });
    }

    // Push notification permission button
    const btnReqPush = document.getElementById('btn-enable-push-notifications');
    if (btnReqPush) {
      btnReqPush.addEventListener('click', async () => {
        const granted = await window.soundAlerts.requestNotificationPermission();
        if (granted) {
          this.showToast('Browser push notifications enabled! You will receive live order alerts.', 'success');
          btnReqPush.style.display = 'none';
        } else {
          this.showToast('Push notification permission was not granted.', 'info');
        }
      });
    }
  },

  // -------------------------------------------------------------
  // Real-Time Server-Sent Events (SSE) Listener
  // -------------------------------------------------------------
  setupSSE() {
    if (this.sseSource) {
      this.sseSource.close();
    }

    const ssePill = document.getElementById('sse-status-pill');
    this.sseSource = new EventSource('/api/events');

    this.sseSource.onopen = () => {
      if (ssePill) {
        ssePill.innerHTML = `<span class="pulse-dot"></span> Live Sync`;
        ssePill.className = 'status-pill live-sse';
      }
    };

    this.sseSource.onerror = () => {
      if (ssePill) {
        ssePill.innerHTML = `<span class="pulse-dot" style="background:#f59e0b;"></span> Reconnecting...`;
        ssePill.className = 'status-pill';
      }
    };

    // 1. New Order Created
    this.sseSource.addEventListener('order_created', (e) => {
      const data = JSON.parse(e.data);
      console.log('SSE: order_created', data);

      // Alert Kitchen Staff with Web Audio Chime & Visual Pulse
      window.soundAlerts.playKitchenAlert();
      window.soundAlerts.sendPush('New Order Received!', {
        body: `${data.order.order_number} (${data.order.fulfillment_type.toUpperCase()}) - $${data.order.total}`
      });

      this.showToast(`🔔 New Order ${data.order.order_number} placed!`, 'info');

      // Refresh Views
      KitchenView.loadOrders();
      if (this.currentView === 'customer') {
        this.loadCustomerOrders();
      }
      AdminView.loadAnalytics();
    });

    // 2. Order Status Updated (Accepted, Preparing, Ready, Delivered)
    this.sseSource.addEventListener('order_updated', (e) => {
      const data = JSON.parse(e.data);
      console.log('SSE: order_updated', data);

      window.soundAlerts.playDing();
      window.soundAlerts.sendPush(`Order ${data.order.order_number} Update`, {
        body: `Status is now: ${data.status.replace(/_/g, ' ').toUpperCase()}`
      });

      this.showToast(`Order #${data.order.order_number} is now ${data.status.replace(/_/g, ' ').toUpperCase()}!`, 'success');

      // Refresh All Queues
      KitchenView.loadOrders();
      DriverView.loadDriverOrders();
      this.loadCustomerOrders();
      AdminView.loadAnalytics();
    });

    // 3. Dynamic Inventory Out-of-Stock Updated
    this.sseSource.addEventListener('inventory_updated', (e) => {
      const data = JSON.parse(e.data);
      console.log('SSE: inventory_updated', data);
      this.showToast(data.message, 'info');
      CustomerView.loadMenu();
      KitchenView.loadInventory();
    });

    // 4. Store Operating Hours & Emergency Switch Updated
    this.sseSource.addEventListener('store_status_updated', (e) => {
      const data = JSON.parse(e.data);
      this.restaurantSettings = data.settings;
      this.updateStoreStatusBanner(data.settings);
      this.showToast('Store operating status updated by manager.', 'info');
    });

    // 5. Support Message Received
    this.sseSource.addEventListener('support_message', (e) => {
      const data = JSON.parse(e.data);
      if (this.currentView === 'admin') {
        AdminView.selectTicket(parseInt(data.ticket_id));
        AdminView.loadSupportTickets();
      }
      if (this.activeCustomerTicket && this.activeCustomerTicket.id == data.ticket_id) {
        this.loadCustomerTicketMessages(data.ticket_id);
      }
      this.showToast(`New support chat message from ${data.message.sender_name}`, 'info');
    });
  },

  updateStoreStatusBanner(settings) {
    const banner = document.getElementById('store-status-banner');
    const headerPill = document.getElementById('header-store-pill');
    const isOpen = (settings.is_store_open === true || settings.is_store_open === 'true');

    if (headerPill) {
      headerPill.className = `status-pill ${isOpen ? 'open' : 'closed'}`;
      headerPill.innerHTML = `<span class="pulse-dot"></span> ${isOpen ? 'Open Now' : 'Closed'}`;
    }

    if (banner) {
      if (!isOpen) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div style="background: #fee2e2; border-bottom: 2px solid #ef4444; color: #991b1b; padding: 0.75rem 1.25rem; text-align: center; font-weight: 700; font-size: 0.9rem;">
            ⚠️ Notice: Restaurant is currently closed (${settings.store_status_message || 'Not accepting orders'}). Menu browsing is open; orders will resume when re-opened.
          </div>
        `;
      } else {
        banner.style.display = 'none';
      }
    }
  },

  // -------------------------------------------------------------
  // Role Switching & Simulation
  // -------------------------------------------------------------
  switchRole(role) {
    this.currentView = role;

    // Update active nav button
    document.querySelectorAll('[data-view-target]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view-target') === role);
    });

    // Toggle active view sections
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const targetSec = document.getElementById(`view-${role}`);
    if (targetSec) targetSec.classList.add('active');

    // Update demo current user profile for role
    if (role === 'customer') {
      this.currentUser = { id: 1, name: "Sarah Jenkins", email: "customer@example.com", role: "customer" };
    } else if (role === 'kitchen') {
      this.currentUser = { id: 3, name: "Chef Marco Rossi", email: "kitchen@example.com", role: "kitchen" };
      KitchenView.loadOrders();
    } else if (role === 'driver') {
      this.currentUser = { id: 4, name: "Alex 'Speedy' Vance", email: "driver@example.com", role: "driver" };
      DriverView.loadDriverOrders();
    } else if (role === 'admin') {
      this.currentUser = { id: 6, name: "Eleanor Vance (GM)", email: "admin@example.com", role: "admin" };
      AdminView.loadAnalytics();
    }

    this.updateUserBadge();
    this.showToast(`Switched to ${role.toUpperCase()} view`, 'info');
  },

  updateUserBadge() {
    const elName = document.getElementById('header-user-name');
    const elRole = document.getElementById('header-user-role');
    const elAvatar = document.getElementById('header-user-avatar');

    if (elName) elName.textContent = this.currentUser.name;
    if (elRole) elRole.textContent = this.currentUser.role;
    if (elAvatar) elAvatar.textContent = this.currentUser.name.charAt(0);
  },

  // -------------------------------------------------------------
  // Authentication Simulation (Google OAuth & Phone OTP)
  // -------------------------------------------------------------
  async simulateGoogleLogin() {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'google',
          name: 'Sarah Jenkins (Google)',
          email: 'sarah.jenkins.google@gmail.com'
        })
      });
      const data = await res.json();
      if (data.success) {
        this.currentUser = data.user;
        this.updateUserBadge();
        document.getElementById('auth-modal').classList.remove('active');
        this.showToast(`Signed in with Google as ${data.user.name}`, 'success');
      }
    } catch (err) {
      console.error(err);
      this.showToast('Google Sign-In failed', 'error');
    }
  },

  async simulatePhoneOtpLogin() {
    const phoneInput = document.getElementById('auth-phone-input');
    const otpInput = document.getElementById('auth-otp-input');
    const phone = phoneInput ? phoneInput.value.trim() : '+15551234567';
    const otp = otpInput ? otpInput.value.trim() : '123456';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'phone_otp',
          phone: phone,
          otp: otp
        })
      });
      const data = await res.json();
      if (data.success) {
        this.currentUser = data.user;
        this.updateUserBadge();
        document.getElementById('auth-modal').classList.remove('active');
        this.showToast(`Phone verified! Logged in as ${data.user.name}`, 'success');
      } else {
        this.showToast(data.error || 'OTP verification failed', 'error');
      }
    } catch (err) {
      console.error(err);
      this.showToast('Phone verification error', 'error');
    }
  },

  // -------------------------------------------------------------
  // Cart Drawer & Local Storage Management
  // -------------------------------------------------------------
  loadCartFromStorage() {
    try {
      const stored = localStorage.getItem('resto_cart');
      if (stored) {
        this.cart = JSON.parse(stored);
      }
    } catch (e) {
      this.cart = [];
    }
  },

  saveCartToStorage() {
    try {
      localStorage.setItem('resto_cart', JSON.stringify(this.cart));
    } catch (e) {}
  },

  openCart() {
    document.getElementById('cart-drawer').classList.add('open');
    document.getElementById('cart-overlay').classList.add('active');
  },

  closeCart() {
    document.getElementById('cart-drawer').classList.remove('open');
    document.getElementById('cart-overlay').classList.remove('active');
  },

  addToCart(item) {
    this.cart.push(item);
    this.saveCartToStorage();
    this.updateCartSummary();
    this.openCart();
  },

  removeFromCart(index) {
    this.cart.splice(index, 1);
    this.saveCartToStorage();
    this.updateCartSummary();
  },

  updateCartSummary() {
    // Counter in header
    const totalCount = this.cart.reduce((sum, it) => sum + it.quantity, 0);
    const counterPill = document.getElementById('header-cart-counter');
    if (counterPill) counterPill.textContent = totalCount;

    const itemsContainer = document.getElementById('cart-items-list');
    const elSubtotal = document.getElementById('cart-subtotal');
    const elDeliveryFee = document.getElementById('cart-delivery-fee');
    const elTax = document.getElementById('cart-tax');
    const elTotal = document.getElementById('cart-total');
    const btnCheckout = document.getElementById('btn-proceed-checkout');

    if (!itemsContainer) return;

    if (this.cart.length === 0) {
      itemsContainer.innerHTML = `
        <div style="text-align: center; padding: 4rem 1rem; color: #94a3b8;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🛍️</div>
          <h4 style="color: #334155; font-weight: 700;">Your Cart is Empty</h4>
          <p style="font-size: 0.85rem; margin-top: 0.25rem;">Explore our delicious burgers, stone-baked pizzas, and bowls!</p>
        </div>
      `;
      if (elSubtotal) elSubtotal.textContent = '$0.00';
      if (elDeliveryFee) elDeliveryFee.textContent = '$0.00';
      if (elTax) elTax.textContent = '$0.00';
      if (elTotal) elTotal.textContent = '$0.00';
      if (btnCheckout) btnCheckout.disabled = true;
      return;
    }

    if (btnCheckout) btnCheckout.disabled = false;

    // Render items
    itemsContainer.innerHTML = this.cart.map((it, idx) => `
      <div class="cart-item-card">
        <div class="cart-item-head">
          <span class="cart-item-name">${it.quantity}x ${it.name}</span>
          <span class="cart-item-price">$${(it.unit_price * it.quantity).toFixed(2)}</span>
        </div>
        <div class="cart-item-customizations">${it.customization_summary}</div>
        ${it.special_notes ? `<div class="cart-item-notes">Note: "${it.special_notes}"</div>` : ''}
        <div class="cart-item-actions">
          <span style="font-size: 0.75rem; color: #64748b;">$${it.unit_price.toFixed(2)} each</span>
          <button type="button" class="btn-remove-cart" onclick="App.removeFromCart(${idx})">Remove</button>
        </div>
      </div>
    `).join('');

    const subtotal = this.cart.reduce((sum, it) => sum + (it.unit_price * it.quantity), 0);
    const isDelivery = CustomerView.fulfillmentType === 'delivery';
    const deliveryFee = isDelivery ? parseFloat(this.restaurantSettings.delivery_fee || 2.99) : 0.0;
    const taxRate = parseFloat(this.restaurantSettings.tax_rate || 0.08);
    const tax = subtotal * taxRate;
    const total = subtotal + deliveryFee + tax;

    if (elSubtotal) elSubtotal.textContent = `$${subtotal.toFixed(2)}`;
    if (elDeliveryFee) elDeliveryFee.textContent = isDelivery ? `$${deliveryFee.toFixed(2)}` : 'FREE (Pickup)';
    if (elTax) elTax.textContent = `$${tax.toFixed(2)}`;
    if (elTotal) elTotal.textContent = `$${total.toFixed(2)}`;
  },

  // -------------------------------------------------------------
  // Order Placement & Strict 3 km Geofence Validation
  // -------------------------------------------------------------
  async processCheckout() {
    if (this.cart.length === 0) {
      this.showToast('Please add items to your cart first', 'info');
      return;
    }

    const isOpen = (this.restaurantSettings.is_store_open === true || this.restaurantSettings.is_store_open === 'true');
    if (!isOpen) {
      alert(`The restaurant is currently closed: ${this.restaurantSettings.store_status_message || 'Please check back soon.'}`);
      return;
    }

    const fulfillment = CustomerView.fulfillmentType;
    let deliveryAddr = null;
    let deliveryLat = null;
    let deliveryLng = null;

    if (fulfillment === 'delivery') {
      const curAddr = CustomerView.selectedAddress || CustomerView.testAddresses[0];

      // STRICT 3 KM GEOFENCE CHECK
      if (curAddr.distance > 3.0) {
        alert(`🚫 STRICT DELIVERY RADIUS RESTRICTION:\n\nYour address (${curAddr.street}) is ${curAddr.distance} km away, which EXCEEDS our maximum 3.0 km local delivery radius.\n\nPlease select Takeaway / Counter Pickup or choose an address within 3 km.`);
        return;
      }

      deliveryAddr = curAddr.street;
      deliveryLat = curAddr.lat;
      deliveryLng = curAddr.lng;
    }

    const paymentRadio = document.querySelector('input[name="payment_method"]:checked');
    const paymentMethod = paymentRadio ? paymentRadio.value : 'online_card';

    const orderPayload = {
      customer_id: this.currentUser.id,
      fulfillment_type: fulfillment,
      payment_method: paymentMethod,
      delivery_address: deliveryAddr,
      delivery_lat: deliveryLat,
      delivery_lng: deliveryLng,
      delivery_notes: fulfillment === 'delivery' ? (CustomerView.selectedAddress ? CustomerView.selectedAddress.delivery_notes : '') : '',
      items: this.cart
    };

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      const data = await res.json();

      if (data.success) {
        this.showToast(`🎉 Order ${data.order.order_number} placed successfully!`, 'success');
        this.cart = [];
        this.saveCartToStorage();
        this.updateCartSummary();
        this.closeCart();

        await this.loadCustomerOrders();

        // Scroll to order tracking section
        const trackSec = document.getElementById('customer-active-orders-section');
        if (trackSec) {
          trackSec.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        alert(data.error || 'Failed to place order');
      }
    } catch (err) {
      console.error(err);
      this.showToast('Network error submitting order', 'error');
    }
  },

  // -------------------------------------------------------------
  // Order Tracking Pipeline (Placed -> Accepted -> Preparing -> Ready -> Delivered)
  // -------------------------------------------------------------
  async loadCustomerOrders() {
    try {
      const res = await fetch(`/api/orders?customer_id=${this.currentUser.id}`);
      const data = await res.json();
      this.customerOrders = data.orders || [];
      this.renderCustomerOrderTracking();
    } catch (err) {
      console.error('Failed to load customer orders:', err);
    }
  },

  renderCustomerOrderTracking() {
    const container = document.getElementById('customer-active-orders-section');
    if (!container) return;

    const activeOrders = this.customerOrders.filter(o => o.status !== 'cancelled' && o.status !== 'rejected');

    if (activeOrders.length === 0) {
      container.innerHTML = `
        <div style="background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 2rem 1.5rem; text-align: center; color: #64748b; margin-bottom: 2rem;">
          <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">🧾</div>
          <h4 style="font-weight: 700; color: #334155;">No Active Orders in Pipeline</h4>
          <p style="font-size: 0.85rem;">Place an order above to watch real-time kitchen progress!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = activeOrders.map(order => {
      const status = order.status;
      const isDelivery = order.fulfillment_type === 'delivery';

      // 5-stage progress pipeline mapping
      const stages = [
        { key: 'placed', label: '1. Placed', icon: '📝' },
        { key: 'accepted', label: '2. Accepted', icon: '👨‍🍳' },
        { key: 'preparing', label: '3. Cooking', icon: '🔥' },
        { key: isDelivery ? 'out_for_delivery' : 'ready_for_pickup', label: isDelivery ? '4. Out for Delivery' : '4. Ready for Pickup', icon: isDelivery ? '🛵' : '🛍️' },
        { key: 'delivered', label: '5. Completed', icon: '🎉' }
      ];

      const stageOrder = ['placed', 'accepted', 'preparing', isDelivery ? 'out_for_delivery' : 'ready_for_pickup', 'delivered'];
      let currentIdx = stageOrder.indexOf(status);
      if (status === 'ready_for_pickup' && isDelivery) {
        currentIdx = 2.5; // between preparing and out for delivery
      }

      return `
        <div class="order-tracking-card" id="customer-track-${order.id}">
          <div class="tracking-header">
            <div class="tracking-title">
              <h3>
                <span>📦 Order #${order.order_number}</span>
                <span class="status-pill live-sse"><span class="pulse-dot"></span> ${status.replace(/_/g, ' ').toUpperCase()}</span>
              </h3>
              <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.2rem;">
                ${isDelivery ? `🛵 Local Delivery to ${order.delivery_address || 'Address'} (${order.delivery_distance_km || 1.2} km)` : '🛍️ Counter Takeaway Pickup'}
                • Placed at ${new Date(order.placed_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </div>
            </div>

            <button type="button" style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; padding: 0.4rem 0.8rem; border-radius: 99px; font-size: 0.78rem; font-weight: 700; cursor: pointer;" onclick="App.openCustomerChatForOrder(${order.id}, '${order.order_number}')">
              💬 Ask Kitchen Support
            </button>
          </div>

          <!-- Step Progress Bar -->
          <div class="status-stepper">
            ${stages.map((stg, sIdx) => {
              const isCompleted = sIdx < currentIdx;
              const isActive = sIdx === currentIdx || (sIdx === 3 && currentIdx === 2.5);
              return `
                <div class="step-node ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}">
                  <div class="step-circle">${isCompleted ? '✓' : stg.icon}</div>
                  <div class="step-label">${stg.label}</div>
                </div>
              `;
            }).join('')}
          </div>

          <div style="background: #f8fafc; border-radius: 8px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <strong>Items in Order:</strong> ${(order.items || []).map(i => `${i.quantity}x ${i.item_name}`).join(', ')}
            </div>
            <div style="font-weight: 800; color: #ff4757;">
              Total: $${parseFloat(order.total).toFixed(2)} (${order.payment_status === 'paid' ? 'Paid Online' : 'Pay on Delivery'})
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // -------------------------------------------------------------
  // In-App Customer Support Chat / Ticketing
  // -------------------------------------------------------------
  async openCustomerChatForOrder(orderId, orderNum) {
    const modal = document.getElementById('customer-chat-modal');
    if (!modal) return;
    modal.classList.add('active');

    // Create or find ticket for this order
    try {
      const res = await fetch(`/api/support/tickets?customer_id=${this.currentUser.id}`);
      const data = await res.json();
      let ticket = (data.tickets || []).find(t => t.order_id === orderId);

      if (!ticket) {
        // Create initial ticket
        const createRes = await fetch('/api/support/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: this.currentUser.id,
            order_id: orderId,
            subject: `Inquiry for Order ${orderNum}`,
            message: 'Hello! I have a question regarding my order preparation/delivery.'
          })
        });
        const cData = await createRes.json();
        ticket = cData.ticket;
      }

      this.activeCustomerTicket = ticket;
      document.getElementById('customer-chat-header-title').textContent = `Chat Support - Order ${orderNum}`;
      this.loadCustomerTicketMessages(ticket.id);
    } catch (err) {
      console.error(err);
    }
  },

  async openCustomerChat() {
    const modal = document.getElementById('customer-chat-modal');
    if (!modal) return;
    modal.classList.add('active');

    try {
      const res = await fetch(`/api/support/tickets?customer_id=${this.currentUser.id}`);
      const data = await res.json();
      let ticket = (data.tickets || [])[0];

      if (!ticket) {
        const createRes = await fetch('/api/support/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: this.currentUser.id,
            subject: 'General Question & Delivery Inquiry',
            message: 'Hi team! Could you help me with a question?'
          })
        });
        const cData = await createRes.json();
        ticket = cData.ticket;
      }

      this.activeCustomerTicket = ticket;
      document.getElementById('customer-chat-header-title').textContent = `Support Desk (${ticket.ticket_number})`;
      this.loadCustomerTicketMessages(ticket.id);
    } catch (err) {
      console.error(err);
    }
  },

  async loadCustomerTicketMessages(ticketId) {
    const container = document.getElementById('customer-chat-messages-container');
    if (!container) return;

    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`);
      const data = await res.json();
      const messages = data.messages || [];

      container.innerHTML = messages.map(m => {
        const isMe = m.sender_id === this.currentUser.id || m.sender_role === 'customer';
        return `
          <div style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 0.75rem;">
            <div style="font-size: 0.7rem; color: #64748b; margin-bottom: 0.15rem;">
              ${m.sender_name} • ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
            <div style="background: ${isMe ? '#ff4757' : '#f1f5f9'}; color: ${isMe ? '#ffffff' : '#0f172a'}; padding: 0.6rem 0.85rem; border-radius: 12px; max-width: 80%; font-size: 0.85rem;">
              ${m.message}
            </div>
          </div>
        `;
      }).join('');
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      console.error(err);
    }
  },

  async sendCustomerChatMessage() {
    if (!this.activeCustomerTicket) return;
    const input = document.getElementById('customer-chat-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    try {
      const res = await fetch(`/api/support/tickets/${this.activeCustomerTicket.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: this.currentUser.id,
          message: text
        })
      });
      const data = await res.json();
      if (data.success) {
        input.value = '';
        await this.loadCustomerTicketMessages(this.activeCustomerTicket.id);
      }
    } catch (err) {
      console.error(err);
      this.showToast('Failed to send message', 'error');
    }
  },

  // -------------------------------------------------------------
  // Global Toast Notifications
  // -------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : '🔔');
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
