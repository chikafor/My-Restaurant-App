/**
 * Kitchen Display System (KDS) & Staff Operations Controller
 * Real-time order fulfillment queue with audio/visual alerting,
 * manual accept/reject workflow, status advancement, driver allocation,
 * and dynamic inventory out-of-stock toggling.
 */

window.KitchenView = {
  orders: [],
  drivers: [],
  inventoryItems: [],
  activeTab: 'orders', // 'orders' or 'inventory'
  rejectingOrderId: null,

  async init() {
    this.setupEventListeners();
    await Promise.all([
      this.loadOrders(),
      this.loadDrivers(),
      this.loadInventory()
    ]);
  },

  setupEventListeners() {
    // Tab switching between Queue & Inventory
    const btnQueue = document.getElementById('kds-tab-queue');
    const btnInv = document.getElementById('kds-tab-inventory');
    if (btnQueue && btnInv) {
      btnQueue.addEventListener('click', () => this.switchTab('orders'));
      btnInv.addEventListener('click', () => this.switchTab('inventory'));
    }

    // Audio test button
    const btnTestAudio = document.getElementById('btn-test-kds-audio');
    if (btnTestAudio) {
      btnTestAudio.addEventListener('click', () => {
        window.soundAlerts.playKitchenAlert();
        App.showToast('Playing kitchen chime test alert 🔔', 'info');
      });
    }

    // Reject Modal Handlers
    const btnConfirmReject = document.getElementById('btn-confirm-kds-reject');
    const btnCancelReject = document.getElementById('btn-cancel-kds-reject');
    if (btnConfirmReject) {
      btnConfirmReject.addEventListener('click', () => this.submitRejectOrder());
    }
    if (btnCancelReject) {
      btnCancelReject.addEventListener('click', () => this.closeRejectModal());
    }

    // Inventory search
    const invSearch = document.getElementById('kds-inv-search');
    if (invSearch) {
      invSearch.addEventListener('input', (e) => {
        this.renderInventoryList(e.target.value.toLowerCase().trim());
      });
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.getElementById('kds-tab-queue').classList.toggle('active', tab === 'orders');
    document.getElementById('kds-tab-inventory').classList.toggle('active', tab === 'inventory');

    document.getElementById('kds-orders-view').style.display = tab === 'orders' ? 'block' : 'none';
    document.getElementById('kds-inventory-view').style.display = tab === 'inventory' ? 'block' : 'none';

    if (tab === 'inventory') {
      this.loadInventory();
    }
  },

  async loadOrders() {
    try {
      const res = await fetch('/api/orders');
      const data = await res.json();
      this.orders = data.orders || [];
      this.renderOrderQueues();
    } catch (err) {
      console.error('Failed to load kitchen orders:', err);
    }
  },

  async loadDrivers() {
    try {
      const res = await fetch('/api/drivers');
      const data = await res.json();
      this.drivers = data.drivers || [];
      this.renderOrderQueues(); // update driver dropdowns
    } catch (err) {
      console.error('Failed to load drivers:', err);
    }
  },

  async loadInventory() {
    try {
      const res = await fetch('/api/menu');
      const data = await res.json();
      this.inventoryItems = data.all_items || [];
      this.renderInventoryList();
    } catch (err) {
      console.error('Failed to load inventory for kitchen:', err);
    }
  },

  renderOrderQueues() {
    const colIncoming = document.getElementById('kds-col-incoming');
    const colPreparing = document.getElementById('kds-col-preparing');
    const colReady = document.getElementById('kds-col-ready');

    if (!colIncoming || !colPreparing || !colReady) return;

    // Filter into stages:
    // 1. Incoming: 'placed'
    // 2. Preparing: 'accepted', 'preparing'
    // 3. Ready: 'ready_for_pickup', 'out_for_delivery'
    const incomingOrders = this.orders.filter(o => o.status === 'placed');
    const prepOrders = this.orders.filter(o => o.status === 'accepted' || o.status === 'preparing');
    const readyOrders = this.orders.filter(o => o.status === 'ready_for_pickup' || o.status === 'out_for_delivery');

    // Update count badges
    document.getElementById('kds-count-incoming').textContent = incomingOrders.length;
    document.getElementById('kds-count-preparing').textContent = prepOrders.length;
    document.getElementById('kds-count-ready').textContent = readyOrders.length;

    colIncoming.innerHTML = incomingOrders.length === 0
      ? `<div style="text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.85rem;">No new incoming orders</div>`
      : incomingOrders.map(o => this.renderTicketCard(o, 'incoming')).join('');

    colPreparing.innerHTML = prepOrders.length === 0
      ? `<div style="text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.85rem;">No dishes currently cooking</div>`
      : prepOrders.map(o => this.renderTicketCard(o, 'preparing')).join('');

    colReady.innerHTML = readyOrders.length === 0
      ? `<div style="text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.85rem;">No orders waiting for pickup/dispatch</div>`
      : readyOrders.map(o => this.renderTicketCard(o, 'ready')).join('');
  },

  renderTicketCard(order, column) {
    const isDelivery = order.fulfillment_type === 'delivery';
    const items = order.items || [];
    const elapsedMinutes = Math.max(1, Math.round((new Date() - new Date(order.placed_at)) / 60000));

    let actionButtons = '';

    if (column === 'incoming') {
      actionButtons = `
        <div class="ticket-actions">
          <button type="button" class="btn-accept" onclick="KitchenView.acceptOrder(${order.id})">
            ✓ Accept
          </button>
          <button type="button" class="btn-reject" onclick="KitchenView.openRejectModal(${order.id})">
            ✕ Reject
          </button>
        </div>
      `;
    } else if (column === 'preparing') {
      if (order.status === 'accepted') {
        actionButtons = `
          <div class="ticket-actions">
            <button type="button" class="btn-advance" onclick="KitchenView.updateOrderStatus(${order.id}, 'preparing')">
              🔥 Start Cooking (Preparing)
            </button>
          </div>
        `;
      } else {
        actionButtons = `
          <div class="ticket-actions">
            <button type="button" class="btn-advance" style="background: #16a34a;" onclick="KitchenView.updateOrderStatus(${order.id}, 'ready_for_pickup')">
              ✅ Mark Ready for ${isDelivery ? 'Driver Dispatch' : 'Counter Pickup'}
            </button>
          </div>
        `;
      }
    } else if (column === 'ready') {
      if (isDelivery) {
        // Driver assignment selector for delivery orders
        const assignedDriver = this.drivers.find(d => d.id === order.driver_id);
        actionButtons = `
          <div class="driver-assign-box">
            <div style="font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 0.3rem;">
              🛵 Assign Delivery Driver:
            </div>
            <select id="select-driver-${order.id}" onchange="KitchenView.assignDriver(${order.id}, this.value)">
              <option value="">-- Choose Driver --</option>
              ${this.drivers.map(d => `
                <option value="${d.id}" ${order.driver_id === d.id ? 'selected' : ''}>
                  ${d.name} (${d.vehicle_type || 'Driver'}) • ${d.active_orders_count || 0} active
                </option>
              `).join('')}
            </select>
            ${assignedDriver ? `
              <div style="font-size: 0.75rem; color: #166534; font-weight: 600;">
                ✓ Allocated to: ${assignedDriver.name}
              </div>
            ` : `
              <div style="font-size: 0.72rem; color: #d97706; font-weight: 600;">
                ⚠️ Unassigned: Awaiting driver allocation
              </div>
            `}
          </div>
        `;
      } else {
        // Takeaway counter pickup complete button
        actionButtons = `
          <div class="ticket-actions">
            <button type="button" class="btn-advance" style="background: #2563eb;" onclick="KitchenView.updateOrderStatus(${order.id}, 'delivered', 'Handed over to customer at counter')">
              🎁 Customer Picked Up Order
            </button>
          </div>
        `;
      }
    }

    return `
      <div class="order-ticket ${column === 'incoming' ? 'new-alert' : ''}" id="kds-ticket-${order.id}">
        <div class="ticket-header">
          <div>
            <span class="ticket-num">${order.order_number}</span>
            <div style="font-size: 0.75rem; font-weight: 600; color: #475569;">${order.customer_name || 'Customer'}</div>
          </div>
          <span class="ticket-type ${isDelivery ? 'delivery' : 'pickup'}">
            ${isDelivery ? '🛵 3km Delivery' : '🛍️ Takeaway'}
          </span>
        </div>

        <div class="ticket-time">
          ⏱️ Placed ${elapsedMinutes}m ago (${new Date(order.placed_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})
          ${order.delivery_distance_km ? ` • 📍 ${order.delivery_distance_km} km` : ''}
        </div>

        ${order.delivery_notes ? `
          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.4rem; font-size: 0.75rem; color: #92400e; margin-bottom: 0.6rem;">
            <strong>Note:</strong> ${order.delivery_notes}
          </div>
        ` : ''}

        <div class="ticket-items">
          ${items.map(it => `
            <div>
              <div class="ticket-item-row">
                <span><span class="ticket-item-qty">${it.quantity}x</span> <strong>${it.item_name}</strong></span>
                <span>$${parseFloat(it.total_price).toFixed(2)}</span>
              </div>
              ${it.customization_summary && it.customization_summary !== 'Standard recipe' ? `
                <div class="ticket-item-custom">↳ ${it.customization_summary}</div>
              ` : ''}
              ${it.special_notes ? `
                <div class="ticket-item-custom" style="color: #ff4757; font-weight: 600;">↳ Note: "${it.special_notes}"</div>
              ` : ''}
            </div>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 700; color: #334155; padding-top: 0.4rem; border-top: 1px solid #f1f5f9;">
          <span>Total (${order.payment_method.replace('_', ' ')}):</span>
          <span style="color: #ff4757;">$${parseFloat(order.total).toFixed(2)}</span>
        </div>

        ${actionButtons}
      </div>
    `;
  },

  async acceptOrder(orderId) {
    try {
      const res = await fetch(`/api/orders/${orderId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Order accepted by kitchen!`, 'success');
        await this.loadOrders();
      } else {
        App.showToast(data.error || 'Failed to accept order', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Network error accepting order', 'error');
    }
  },

  openRejectModal(orderId) {
    this.rejectingOrderId = orderId;
    const modal = document.getElementById('kds-reject-modal');
    if (modal) modal.classList.add('active');
  },

  closeRejectModal() {
    this.rejectingOrderId = null;
    const modal = document.getElementById('kds-reject-modal');
    if (modal) modal.classList.remove('active');
  },

  async submitRejectOrder() {
    if (!this.rejectingOrderId) return;
    const reasonSelect = document.getElementById('kds-reject-reason');
    const customReason = document.getElementById('kds-reject-custom');
    const reason = (customReason && customReason.value.trim()) || (reasonSelect ? reasonSelect.value : 'Kitchen at capacity');

    try {
      const res = await fetch(`/api/orders/${this.rejectingOrderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json_payload({ reason })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast('Order rejected with reason provided to customer', 'info');
        this.closeRejectModal();
        await this.loadOrders();
      } else {
        App.showToast(data.error || 'Failed to reject order', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error rejecting order', 'error');
    }
  },

  async updateOrderStatus(orderId, status, note = '') {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Order marked as ${status.replace('_', ' ').toUpperCase()}`, 'success');
        await this.loadOrders();
      } else {
        App.showToast(data.error || 'Status update failed', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error updating status', 'error');
    }
  },

  async assignDriver(orderId, driverId) {
    if (!driverId) return;
    try {
      const res = await fetch(`/api/orders/${orderId}/assign-driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: parseInt(driverId) })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Driver assigned to order!`, 'success');
        await Promise.all([this.loadOrders(), this.loadDrivers()]);
      } else {
        App.showToast(data.error || 'Failed to assign driver', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error assigning driver', 'error');
    }
  },

  // -----------------------------------------------------------------
  // Dynamic Inventory Toggling (Sold Out / In Stock)
  // -----------------------------------------------------------------
  renderInventoryList(filter = '') {
    const container = document.getElementById('kds-inventory-items-list');
    if (!container) return;

    let items = this.inventoryItems;
    if (filter) {
      items = items.filter(it => it.name.toLowerCase().includes(filter));
    }

    container.innerHTML = items.map(item => {
      const isAvail = item.is_available === 1;
      return `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.85rem;">
            <img src="${item.image_url}" style="width: 48px; height: 48px; border-radius: 8px; object-fit: cover;" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'" />
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; color: #1e293b;">${item.name}</div>
              <div style="font-size: 0.8rem; color: #64748b;">$${parseFloat(item.price).toFixed(2)}</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 1rem;">
            <span style="font-size: 0.825rem; font-weight: 700; color: ${isAvail ? '#166534' : '#991b1b'};">
              ${isAvail ? '● Available / In Stock' : '✕ Sold Out / Out of Stock'}
            </span>
            <button 
              type="button" 
              style="background: ${isAvail ? '#fee2e2' : '#dcfce7'}; color: ${isAvail ? '#dc2626' : '#166534'}; border: 1px solid ${isAvail ? '#fca5a5' : '#86efac'}; padding: 0.45rem 0.9rem; border-radius: 6px; font-weight: 700; font-size: 0.825rem; cursor: pointer;"
              onclick="KitchenView.toggleItemAvailability(${item.id})">
              ${isAvail ? 'Mark Sold Out' : 'Mark In Stock'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async toggleItemAvailability(itemId) {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Item availability updated!`, 'info');
        await this.loadInventory();
        // Also refresh customer menu
        CustomerView.loadMenu();
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error updating item inventory', 'error');
    }
  }
};

function json_payload(obj) {
  return JSON.stringify(obj);
}
