/**
 * Delivery Driver Operations Controller
 * Mobile-optimized view for delivery drivers:
 * Assigned order queue, customer contact details, delivery address navigation,
 * special delivery instructions, and status transitions:
 * 'Ready for Pickup' -> 'Out for Delivery' -> 'Delivered'.
 */

window.DriverView = {
  driverOrders: [],
  historyOrders: [],
  activeDriverId: 4, // Default to Alex 'Speedy' Vance (id: 4)

  async init() {
    this.setupEventListeners();
    await this.loadDriverOrders();
  },

  setupEventListeners() {
    const driverSelect = document.getElementById('driver-user-switcher');
    if (driverSelect) {
      driverSelect.addEventListener('change', (e) => {
        this.activeDriverId = parseInt(e.target.value);
        this.loadDriverOrders();
      });
    }
  },

  async loadDriverOrders() {
    try {
      const res = await fetch(`/api/orders?driver_id=${this.activeDriverId}`);
      const data = await res.json();
      const all = data.orders || [];

      this.driverOrders = all.filter(o => o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'rejected');
      this.historyOrders = all.filter(o => o.status === 'delivered');

      this.renderDriverQueue();
      this.renderDriverHistory();
    } catch (err) {
      console.error('Failed to load driver orders:', err);
    }
  },

  renderDriverQueue() {
    const container = document.getElementById('driver-assigned-orders');
    if (!container) return;

    if (this.driverOrders.length === 0) {
      container.innerHTML = `
        <div style="background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 3rem 1.5rem; text-align: center; color: #64748b;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🛵</div>
          <h3 style="color: #1e293b; font-weight: 800;">No Active Deliveries Assigned</h3>
          <p style="font-size: 0.9rem; margin-top: 0.35rem;">Kitchen staff will assign ready 3km delivery orders to you shortly.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.driverOrders.map(order => {
      const items = order.items || [];
      const isOutForDelivery = order.status === 'out_for_delivery';
      const isPaid = order.payment_status === 'paid';

      return `
        <div class="driver-card" id="driver-card-${order.id}">
          <div class="driver-head">
            <div>
              <span style="font-weight: 800; font-size: 1.2rem; color: #0f172a;">${order.order_number}</span>
              <div style="font-size: 0.85rem; color: #475569; font-weight: 600;">Customer: ${order.customer_name || 'Customer'}</div>
            </div>
            <span class="status-pill ${isOutForDelivery ? 'open' : 'live-sse'}">
              <span class="pulse-dot"></span> ${order.status.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>

          <div class="driver-dest">
            <div style="font-size: 0.78rem; text-transform: uppercase; font-weight: 800; color: #ff4757; margin-bottom: 0.2rem;">
              📍 Delivery Destination (Within 3 km Radius)
            </div>
            <div style="font-size: 1rem; font-weight: 700; color: #0f172a; margin-bottom: 0.35rem;">
              ${order.delivery_address || 'Address provided at checkout'}
            </div>
            <div style="display: flex; gap: 1rem; font-size: 0.825rem; color: #475569;">
              <span>📏 Distance: <strong>${order.delivery_distance_km || 1.2} km</strong></span>
              <span>📞 Phone: <a href="tel:${order.customer_phone || '+15551234567'}" style="color: #2563eb; font-weight: 700;">${order.customer_phone || '+1 555-123-4567'}</a></span>
            </div>
            ${order.delivery_notes ? `
              <div style="margin-top: 0.6rem; padding: 0.4rem; background: #fffbeb; border-radius: 6px; font-size: 0.78rem; color: #b45309;">
                <strong>Special Customer Note:</strong> "${order.delivery_notes}"
              </div>
            ` : ''}
          </div>

          <div style="margin-bottom: 1rem; font-size: 0.85rem;">
            <div style="font-weight: 700; color: #334155; margin-bottom: 0.35rem;">🎒 Food Package Contents:</div>
            <ul style="padding-left: 1.25rem; color: #475569;">
              ${items.map(it => `
                <li><strong>${it.quantity}x</strong> ${it.item_name} ${it.customization_summary && it.customization_summary !== 'Standard recipe' ? `<span style="font-size: 0.75rem; color: #64748b;">(${it.customization_summary})</span>` : ''}</li>
              `).join('')}
            </ul>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-top: 1px dashed #e2e8f0; margin-bottom: 1rem; font-size: 0.9rem;">
            <span>Payment Status:</span>
            <span style="font-weight: 800; color: ${isPaid ? '#166534' : '#b45309'};">
              ${isPaid ? '✅ Paid Online (Contactless)' : `💵 Collect Cash: $${parseFloat(order.total).toFixed(2)}`}
            </span>
          </div>

          <div>
            ${!isOutForDelivery ? `
              <button 
                type="button" 
                class="driver-btn-action" 
                style="background: #2563eb; color: #ffffff;"
                onclick="DriverView.transitionStatus(${order.id}, 'out_for_delivery')">
                🚀 Picked Up from Kitchen & Start Delivery
              </button>
            ` : `
              <button 
                type="button" 
                class="driver-btn-action" 
                style="background: #16a34a; color: #ffffff;"
                onclick="DriverView.transitionStatus(${order.id}, 'delivered')">
                🎉 Confirm Handed to Customer (Delivered)
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  renderDriverHistory() {
    const container = document.getElementById('driver-history-orders');
    if (!container) return;

    if (this.historyOrders.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: #94a3b8; font-size: 0.85rem; padding: 1rem;">No completed deliveries today yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
          <thead style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left;">
            <tr>
              <th style="padding: 0.75rem 1rem;">Order #</th>
              <th style="padding: 0.75rem 1rem;">Destination</th>
              <th style="padding: 0.75rem 1rem;">Distance</th>
              <th style="padding: 0.75rem 1rem;">Total</th>
              <th style="padding: 0.75rem 1rem;">Delivered At</th>
            </tr>
          </thead>
          <tbody>
            ${this.historyOrders.map(o => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 0.75rem 1rem; font-weight: 700;">${o.order_number}</td>
                <td style="padding: 0.75rem 1rem; color: #475569;">${o.delivery_address || 'Camden Walk'}</td>
                <td style="padding: 0.75rem 1rem;">${o.delivery_distance_km || 1.2} km</td>
                <td style="padding: 0.75rem 1rem; font-weight: 700; color: #166534;">$${parseFloat(o.total).toFixed(2)}</td>
                <td style="padding: 0.75rem 1rem; color: #64748b;">${new Date(o.delivered_at || o.placed_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  async transitionStatus(orderId, nextStatus) {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`Order updated to: ${nextStatus.replace('_', ' ').toUpperCase()}`, 'success');
        await this.loadDriverOrders();
        // Also refresh customer tracking if relevant
        App.loadCustomerOrders();
      } else {
        App.showToast(data.error || 'Failed to update order', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error updating delivery status', 'error');
    }
  }
};
