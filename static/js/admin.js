/**
 * Admin & Management Portal Controller
 * Business analytics, KPI cards, top-selling items, peak ordering hours chart,
 * store operating hours & emergency open/closed switch, staff/driver account management,
 * and unified customer support desk with live ticketing chat.
 */

window.AdminView = {
  activeTab: 'analytics', // 'analytics', 'operations', 'staff', 'support'
  period: 'all', // 'today', 'week', 'month', 'all'
  analyticsData: null,
  staffUsers: [],
  supportTickets: [],
  activeTicketId: null,

  async init() {
    this.setupEventListeners();
    await Promise.all([
      this.loadAnalytics(),
      this.loadSettings(),
      this.loadStaff(),
      this.loadSupportTickets()
    ]);
  },

  setupEventListeners() {
    // Admin Subtabs
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-admin-tab');
        this.switchTab(tab);
      });
    });

    // Analytics Period Filter
    const periodSelect = document.getElementById('analytics-period-select');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.period = e.target.value;
        this.loadAnalytics();
      });
    }

    // Save Store Settings & Operating Hours Form
    const storeHoursForm = document.getElementById('store-hours-form');
    if (storeHoursForm) {
      storeHoursForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveStoreSettings();
      });
    }

    // Add Staff Modal Handlers
    const btnAddStaff = document.getElementById('btn-open-add-staff-modal');
    const modalAddStaff = document.getElementById('admin-add-staff-modal');
    const btnCloseAddStaff = document.getElementById('btn-close-add-staff-modal');
    const addStaffForm = document.getElementById('add-staff-form');

    if (btnAddStaff && modalAddStaff) {
      btnAddStaff.addEventListener('click', () => modalAddStaff.classList.add('active'));
    }
    if (btnCloseAddStaff && modalAddStaff) {
      btnCloseAddStaff.addEventListener('click', () => modalAddStaff.classList.remove('active'));
    }
    if (addStaffForm) {
      addStaffForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitNewStaff();
      });
    }

    // Support message reply form
    const supportReplyForm = document.getElementById('admin-support-reply-form');
    if (supportReplyForm) {
      supportReplyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendSupportReply();
      });
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-admin-tab') === tab);
    });

    document.getElementById('admin-sec-analytics').style.display = tab === 'analytics' ? 'block' : 'none';
    document.getElementById('admin-sec-operations').style.display = tab === 'operations' ? 'block' : 'none';
    document.getElementById('admin-sec-staff').style.display = tab === 'staff' ? 'block' : 'none';
    document.getElementById('admin-sec-support').style.display = tab === 'support' ? 'block' : 'none';

    if (tab === 'analytics') this.loadAnalytics();
    if (tab === 'operations') this.loadSettings();
    if (tab === 'staff') this.loadStaff();
    if (tab === 'support') this.loadSupportTickets();
  },

  // -------------------------------------------------------------
  // Analytics & KPIs
  // -------------------------------------------------------------
  async loadAnalytics() {
    try {
      const res = await fetch(`/api/admin/analytics?period=${this.period}`);
      const data = await res.json();
      this.analyticsData = data;
      this.renderAnalytics();
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  },

  renderAnalytics() {
    if (!this.analyticsData) return;
    const { kpis, top_items, hourly_distribution, payment_breakdown } = this.analyticsData;

    // KPI Cards
    const elRev = document.getElementById('kpi-total-revenue');
    const elOrders = document.getElementById('kpi-total-orders');
    const elAov = document.getElementById('kpi-avg-order-value');
    const elRatio = document.getElementById('kpi-ratio');

    if (elRev) elRev.textContent = `$${parseFloat(kpis.total_revenue || 0).toFixed(2)}`;
    if (elOrders) elOrders.textContent = kpis.total_orders || 0;
    if (elAov) elAov.textContent = `$${parseFloat(kpis.avg_order_value || 0).toFixed(2)}`;
    
    if (elRatio) {
      const del = kpis.delivery_count || 0;
      const pick = kpis.pickup_count || 0;
      const total = del + pick;
      const delPct = total > 0 ? Math.round((del / total) * 100) : 50;
      elRatio.textContent = `${delPct}% Delivery / ${100 - delPct}% Pickup`;
    }

    // Top Selling Items
    const topContainer = document.getElementById('analytics-top-items');
    if (topContainer) {
      if (!top_items || top_items.length === 0) {
        topContainer.innerHTML = `<div style="color: #94a3b8; font-size: 0.85rem;">No item sales data for this period.</div>`;
      } else {
        const maxSold = Math.max(...top_items.map(t => t.total_sold), 1);
        topContainer.innerHTML = top_items.map(it => {
          const pct = Math.round((it.total_sold / maxSold) * 100);
          return `
            <div style="margin-bottom: 0.85rem;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 700; margin-bottom: 0.25rem;">
                <span>${it.item_name}</span>
                <span style="color: #ff4757;">${it.total_sold} orders • $${parseFloat(it.total_revenue).toFixed(2)}</span>
              </div>
              <div style="background: #f1f5f9; height: 8px; border-radius: 99px; overflow: hidden;">
                <div style="background: linear-gradient(90deg, #ff4757, #ffa502); height: 100%; width: ${pct}%; border-radius: 99px;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Hourly Distribution Chart (SVG Bar Chart)
    const hoursChart = document.getElementById('analytics-hourly-chart');
    if (hoursChart) {
      if (!hourly_distribution || hourly_distribution.length === 0) {
        hoursChart.innerHTML = `<div style="color: #94a3b8; font-size: 0.85rem; padding: 2rem; text-align: center;">No hourly order data yet.</div>`;
      } else {
        const maxCount = Math.max(...hourly_distribution.map(h => h.order_count), 1);
        hoursChart.innerHTML = `
          <div style="display: flex; align-items: flex-end; gap: 0.75rem; height: 160px; padding-top: 1rem;">
            ${hourly_distribution.map(h => {
              const heightPct = Math.max(12, Math.round((h.order_count / maxCount) * 100));
              return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; height: 100%; justify-content: flex-end;">
                  <span style="font-size: 0.75rem; font-weight: 800; color: #1e293b;">${h.order_count}</span>
                  <div style="width: 100%; background: #3b82f6; height: ${heightPct}%; border-radius: 4px 4px 0 0;" title="${h.order_count} orders at ${h.hour}"></div>
                  <span style="font-size: 0.7rem; color: #64748b; font-weight: 600;">${h.hour}</span>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    }
  },

  // -------------------------------------------------------------
  // Operations & Operating Hours Management
  // -------------------------------------------------------------
  async loadSettings() {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      const settings = data.settings || {};
      App.restaurantSettings = settings;

      // Populate Emergency Toggle
      const storeToggle = document.getElementById('setting-store-open');
      const storeMsg = document.getElementById('setting-store-msg');
      if (storeToggle) storeToggle.checked = (settings.is_store_open === true || settings.is_store_open === 'true');
      if (storeMsg) storeMsg.value = settings.store_status_message || '';

      // Populate Address & Radius
      const setAddr = document.getElementById('setting-rest-address');
      const setRadius = document.getElementById('setting-delivery-radius');
      const setFee = document.getElementById('setting-delivery-fee');
      if (setAddr) setAddr.value = settings.restaurant_address || '';
      if (setRadius) setRadius.value = settings.delivery_radius_km || 3.0;
      if (setFee) setFee.value = settings.delivery_fee || 2.99;

      // Update global header status pill
      App.updateStoreStatusBanner(settings);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  async saveStoreSettings() {
    const isStoreOpen = document.getElementById('setting-store-open').checked;
    const storeMsg = document.getElementById('setting-store-msg').value;
    const restAddress = document.getElementById('setting-rest-address').value;
    const deliveryRadius = parseFloat(document.getElementById('setting-delivery-radius').value || 3.0);
    const deliveryFee = parseFloat(document.getElementById('setting-delivery-fee').value || 2.99);

    const payload = {
      is_store_open: isStoreOpen,
      store_status_message: storeMsg,
      restaurant_address: restAddress,
      delivery_radius_km: deliveryRadius,
      delivery_fee: deliveryFee
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        App.restaurantSettings = data.settings;
        App.updateStoreStatusBanner(data.settings);
        App.showToast('Store settings & operating status saved successfully!', 'success');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Failed to save settings', 'error');
    }
  },

  // -------------------------------------------------------------
  // Staff & Driver Account Management
  // -------------------------------------------------------------
  async loadStaff() {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      this.staffUsers = data.users || [];
      this.renderStaffList();
    } catch (err) {
      console.error('Failed to load staff accounts:', err);
    }
  },

  renderStaffList() {
    const container = document.getElementById('admin-staff-list');
    if (!container) return;

    const filtered = this.staffUsers.filter(u => u.role !== 'customer');

    container.innerHTML = `
      <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
        <thead style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left;">
          <tr>
            <th style="padding: 0.75rem 1rem;">Name</th>
            <th style="padding: 0.75rem 1rem;">Role</th>
            <th style="padding: 0.75rem 1rem;">Contact</th>
            <th style="padding: 0.75rem 1rem;">Vehicle / Details</th>
            <th style="padding: 0.75rem 1rem;">Status</th>
            <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(u => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 0.75rem 1rem; font-weight: 700; color: #0f172a;">${u.name}</td>
              <td style="padding: 0.75rem 1rem;">
                <span class="dietary-tag" style="text-transform: uppercase;">${u.role}</span>
              </td>
              <td style="padding: 0.75rem 1rem; color: #475569;">
                ${u.email}<br><span style="font-size: 0.75rem;">${u.phone || 'No phone'}</span>
              </td>
              <td style="padding: 0.75rem 1rem; color: #475569;">
                ${u.vehicle_type || '—'}
              </td>
              <td style="padding: 0.75rem 1rem;">
                <span style="font-weight: 700; color: ${u.is_active ? '#166534' : '#991b1b'};">
                  ${u.is_active ? '● Active' : '✕ Inactive'}
                </span>
              </td>
              <td style="padding: 0.75rem 1rem; text-align: right;">
                <button 
                  type="button" 
                  style="border: 1px solid #cbd5e1; background: #ffffff; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600; cursor: pointer;"
                  onclick="AdminView.toggleUserActive(${u.id})">
                  ${u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async toggleUserActive(userId) {
    try {
      const res = await fetch(`/api/users/${userId}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        App.showToast('User account status updated', 'info');
        await this.loadStaff();
      }
    } catch (err) {
      console.error(err);
      App.showToast('Failed to update account', 'error');
    }
  },

  async submitNewStaff() {
    const name = document.getElementById('staff-add-name').value;
    const email = document.getElementById('staff-add-email').value;
    const phone = document.getElementById('staff-add-phone').value;
    const role = document.getElementById('staff-add-role').value;
    const vehicle = document.getElementById('staff-add-vehicle').value;

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, role, vehicle_type: vehicle })
      });
      const data = await res.json();
      if (data.success) {
        App.showToast(`New ${role} account created for ${name}!`, 'success');
        document.getElementById('admin-add-staff-modal').classList.remove('active');
        document.getElementById('add-staff-form').reset();
        await this.loadStaff();
      } else {
        App.showToast(data.error || 'Failed to create user', 'error');
      }
    } catch (err) {
      console.error(err);
      App.showToast('Error creating user account', 'error');
    }
  },

  // -------------------------------------------------------------
  // Customer Support Desk & Live Chat
  // -------------------------------------------------------------
  async loadSupportTickets() {
    try {
      const res = await fetch('/api/support/tickets');
      const data = await res.json();
      this.supportTickets = data.tickets || [];
      this.renderSupportDesk();
      if (this.supportTickets.length > 0 && !this.activeTicketId) {
        this.selectTicket(this.supportTickets[0].id);
      }
    } catch (err) {
      console.error('Failed to load support tickets:', err);
    }
  },

  renderSupportDesk() {
    const listContainer = document.getElementById('admin-support-tickets-list');
    if (!listContainer) return;

    if (this.supportTickets.length === 0) {
      listContainer.innerHTML = `<div style="padding: 1.5rem; color: #94a3b8; font-size: 0.85rem;">No support inquiries submitted yet.</div>`;
      return;
    }

    listContainer.innerHTML = this.supportTickets.map(t => {
      const isSelected = this.activeTicketId === t.id;
      return `
        <div 
          style="padding: 1rem; border-bottom: 1px solid #e2e8f0; cursor: pointer; background: ${isSelected ? '#fff0f1' : '#ffffff'}; border-left: 4px solid ${isSelected ? '#ff4757' : 'transparent'};"
          onclick="AdminView.selectTicket(${t.id})">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span style="font-weight: 800; font-size: 0.85rem; color: #0f172a;">${t.ticket_number} • ${t.customer_name}</span>
            <span class="dietary-tag" style="background: ${t.status === 'open' ? '#fee2e2' : (t.status === 'in_progress' ? '#fef3c7' : '#dcfce7')}; color: #0f172a;">
              ${t.status.toUpperCase()}
            </span>
          </div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 0.3rem;">
            ${t.subject} ${t.order_number ? `(Re: ${t.order_number})` : ''}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${t.last_message || 'No messages yet'}
          </div>
        </div>
      `;
    }).join('');
  },

  async selectTicket(ticketId) {
    this.activeTicketId = ticketId;
    this.renderSupportDesk();

    const threadContainer = document.getElementById('admin-support-chat-messages');
    const titleContainer = document.getElementById('admin-support-active-title');
    if (!threadContainer) return;

    const ticket = this.supportTickets.find(t => t.id === ticketId);
    if (titleContainer && ticket) {
      titleContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div>
            <strong>${ticket.ticket_number}: ${ticket.subject}</strong>
            <div style="font-size: 0.75rem; color: #64748b;">Customer: ${ticket.customer_name} (${ticket.customer_phone || ticket.customer_email})</div>
          </div>
          ${ticket.status !== 'resolved' ? `
            <button type="button" style="background: #16a34a; color: #ffffff; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;" onclick="AdminView.resolveTicket(${ticket.id})">
              ✓ Mark Resolved
            </button>
          ` : `<span style="font-size: 0.75rem; color: #166534; font-weight: 700;">✓ Resolved</span>`}
        </div>
      `;
    }

    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`);
      const data = await res.json();
      const messages = data.messages || [];

      threadContainer.innerHTML = messages.map(m => {
        const isAdmin = m.sender_role === 'admin' || m.sender_role === 'staff';
        return `
          <div style="display: flex; flex-direction: column; align-items: ${isAdmin ? 'flex-end' : 'flex-start'}; margin-bottom: 0.85rem;">
            <div style="font-size: 0.72rem; color: #64748b; margin-bottom: 0.2rem;">
              ${m.sender_name} (${m.sender_role}) • ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
            <div style="background: ${isAdmin ? '#ff4757' : '#f1f5f9'}; color: ${isAdmin ? '#ffffff' : '#0f172a'}; padding: 0.65rem 0.9rem; border-radius: 12px; max-width: 80%; font-size: 0.85rem;">
              ${m.message}
            </div>
          </div>
        `;
      }).join('');
      threadContainer.scrollTop = threadContainer.scrollHeight;
    } catch (err) {
      console.error(err);
    }
  },

  async sendSupportReply() {
    if (!this.activeTicketId) return;
    const input = document.getElementById('admin-support-reply-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    try {
      const res = await fetch(`/api/support/tickets/${this.activeTicketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: App.currentUser ? App.currentUser.id : 6, // default admin
          message: text
        })
      });
      const data = await res.json();
      if (data.success) {
        input.value = '';
        await this.selectTicket(this.activeTicketId);
        await this.loadSupportTickets();
      }
    } catch (err) {
      console.error(err);
      App.showToast('Failed to send reply', 'error');
    }
  },

  async resolveTicket(ticketId) {
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/resolve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        App.showToast('Ticket marked as resolved!', 'success');
        await this.loadSupportTickets();
        await this.selectTicket(ticketId);
      }
    } catch (err) {
      console.error(err);
    }
  }
};
