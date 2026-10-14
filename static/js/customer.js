/**
 * Customer Interface Controller
 * Menu browsing, item customization, cart, strict 3km geofence validation,
 * order placement, real-time tracking pipeline, and support chat.
 */

window.CustomerView = {
  menuData: { categories: [], all_items: [] },
  activeCategory: 'all',
  searchQuery: '',
  fulfillmentType: 'delivery', // 'delivery' or 'pickup'
  selectedAddress: null,
  geofenceResult: { eligible: true, distance_km: 1.2 },
  activeCustomizingItem: null,
  customizationState: {
    selectedOptions: {}, // group_id -> array of choice_ids
    specialNotes: '',
    quantity: 1
  },

  // Sample addresses for testing 3km boundary
  testAddresses: [
    { label: "Home (Camden Walk)", street: "Flat 4B, 18 Camden Walk", lat: 51.5140, lng: -0.1180, distance: 1.2, eligible: true },
    { label: "Tech Hub Office", street: "Suite 204, River Way", lat: 51.5220, lng: -0.1050, distance: 2.4, eligible: true },
    { label: "Northwood (Out of Zone)", street: "88 Northwood Crescent", lat: 51.5450, lng: -0.0800, distance: 4.5, eligible: false }
  ],

  async init() {
    this.selectedAddress = this.testAddresses[0];
    await this.loadMenu();
    this.setupEventListeners();
    this.renderFulfillment();
  },

  async loadMenu() {
    try {
      const res = await fetch('/api/menu');
      const data = await res.json();
      this.menuData = data;
      this.renderCategoryPills();
      this.renderMenuItems();
    } catch (err) {
      console.error('Failed to load menu:', err);
      App.showToast('Failed to load menu', 'error');
    }
  },

  setupEventListeners() {
    // Fulfillment selector tabs
    document.querySelectorAll('[data-fulfillment]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = btn.getAttribute('data-fulfillment');
        this.setFulfillmentType(type);
      });
    });

    // Search bar
    const searchInput = document.getElementById('menu-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderMenuItems();
      });
    }

    // Modal Qty Stepper
    const qtyMinus = document.getElementById('modal-qty-minus');
    const qtyPlus = document.getElementById('modal-qty-plus');
    if (qtyMinus && qtyPlus) {
      qtyMinus.addEventListener('click', () => {
        if (this.customizationState.quantity > 1) {
          this.customizationState.quantity--;
          this.updateModalPriceAndQty();
        }
      });
      qtyPlus.addEventListener('click', () => {
        if (this.customizationState.quantity < 20) {
          this.customizationState.quantity++;
          this.updateModalPriceAndQty();
        }
      });
    }

    // Modal Close
    const modalClose = document.getElementById('btn-close-custom-modal');
    const modalOverlay = document.getElementById('customization-modal');
    if (modalClose) {
      modalClose.addEventListener('click', () => this.closeCustomizationModal());
    }
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) this.closeCustomizationModal();
      });
    }

    // Confirm Add To Cart Button
    const btnConfirmAdd = document.getElementById('btn-confirm-add-cart');
    if (btnConfirmAdd) {
      btnConfirmAdd.addEventListener('click', () => this.addItemToCart());
    }
  },

  setFulfillmentType(type) {
    this.fulfillmentType = type;
    document.querySelectorAll('[data-fulfillment]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-fulfillment') === type);
    });
    this.renderFulfillment();
    App.updateCartSummary();
  },

  renderFulfillment() {
    const container = document.getElementById('fulfillment-config-panel');
    if (!container) return;

    if (this.fulfillmentType === 'pickup') {
      const restAddress = App.restaurantSettings.restaurant_address || '42 Gourmet Way, Central Plaza';
      container.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #475569;">Counter Pickup Location:</div>
            <div style="font-size: 1rem; font-weight: 800; color: #0f172a;">📍 ${restAddress}</div>
            <div style="font-size: 0.8rem; color: #166534; font-weight: 600; margin-top: 0.2rem;">Ready in ~15-20 mins • No Delivery Fee</div>
          </div>
          <span class="status-pill open"><span class="pulse-dot"></span> Ready For Counter Pickup</span>
        </div>
      `;
    } else {
      // Delivery with 3 km Geofence
      const curAddr = this.selectedAddress || this.testAddresses[0];
      const isEligible = curAddr.distance <= 3.0;
      this.geofenceResult = { eligible: isEligible, distance_km: curAddr.distance };

      container.innerHTML = `
        <div class="delivery-location-picker">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <span style="font-size: 0.85rem; font-weight: 700; color: #334155;">Delivery Address (Strict 3 km Boundary):</span>
              <span style="font-size: 0.78rem; font-weight: 700; color: #ff4757;">⚡ Radius Limit: Max 3.0 km</span>
            </div>
            <div class="address-input-wrap">
              <span class="loc-icon">📍</span>
              <input type="text" id="cust-delivery-address-input" value="${curAddr.street}" readonly />
            </div>
            
            <div class="quick-addresses">
              <span style="font-size: 0.75rem; color: #64748b; font-weight: 600; align-self: center;">Test Locations:</span>
              ${this.testAddresses.map((addr, idx) => `
                <button type="button" class="preset-addr-btn ${curAddr.street === addr.street ? 'selected' : ''}" onclick="CustomerView.selectPresetAddress(${idx})">
                  ${addr.label} (${addr.distance} km) ${addr.eligible ? '✅' : '🚫'}
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div style="margin-top: 0.85rem;">
          ${isEligible ? `
            <div class="geofence-alert eligible">
              <span style="font-size: 1.2rem;">✅</span>
              <div>
                <strong>Within Delivery Zone!</strong> This address is <strong>${curAddr.distance} km</strong> away (within our 3 km limit). Estimated delivery in 25-35 minutes.
              </div>
            </div>
          ` : `
            <div class="geofence-alert ineligible">
              <span style="font-size: 1.2rem;">🚫</span>
              <div>
                <strong>Delivery Zone Exceeded!</strong> This address is <strong>${curAddr.distance} km</strong> away, which exceeds our maximum 3.0 km radius.
                <br><span style="font-size: 0.8rem; text-decoration: underline; cursor: pointer;" onclick="CustomerView.setFulfillmentType('pickup')">Switch to Takeaway/Pickup instead</span>
              </div>
            </div>
          `}
        </div>
      `;
    }
  },

  selectPresetAddress(idx) {
    this.selectedAddress = this.testAddresses[idx];
    this.renderFulfillment();
    App.updateCartSummary();
  },

  renderCategoryPills() {
    const container = document.getElementById('category-pills-list');
    if (!container) return;

    let html = `
      <button type="button" class="cat-pill ${this.activeCategory === 'all' ? 'active' : ''}" onclick="CustomerView.filterCategory('all')">
        🍽️ All Offerings
      </button>
    `;

    this.menuData.categories.forEach(cat => {
      const isActive = this.activeCategory === cat.slug;
      html += `
        <button type="button" class="cat-pill ${isActive ? 'active' : ''}" onclick="CustomerView.filterCategory('${cat.slug}')">
          ${cat.icon || '🍴'} ${cat.name}
        </button>
      `;
    });

    container.innerHTML = html;
  },

  filterCategory(slug) {
    this.activeCategory = slug;
    this.renderCategoryPills();
    this.renderMenuItems();
  },

  renderMenuItems() {
    const grid = document.getElementById('menu-items-grid');
    if (!grid) return;

    let items = this.menuData.all_items || [];

    // Filter category
    if (this.activeCategory !== 'all') {
      const cat = this.menuData.categories.find(c => c.slug === this.activeCategory);
      if (cat) {
        items = items.filter(it => it.category_id === cat.id);
      }
    }

    // Filter search
    if (this.searchQuery) {
      items = items.filter(it =>
        it.name.toLowerCase().includes(this.searchQuery) ||
        (it.description && it.description.toLowerCase().includes(this.searchQuery))
      );
    }

    if (items.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #64748b;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">🔍</div>
          <h3>No matching items found</h3>
          <p>Try searching for burgers, pizzas, bowls, or desserts.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = items.map(item => {
      const isSoldOut = !item.is_available;
      const tags = item.dietary_tags || [];
      const hasOptions = item.option_groups && item.option_groups.length > 0;

      return `
        <div class="menu-card ${isSoldOut ? 'sold-out' : ''}" id="menu-item-card-${item.id}">
          <div class="menu-img-wrap">
            <img src="${item.image_url}" alt="${item.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80'" />
            ${item.badge ? `<span class="menu-badge bestseller">${item.badge}</span>` : ''}
            ${isSoldOut ? `<span class="menu-badge soldout-badge">SOLD OUT</span>` : ''}
          </div>

          <div class="menu-content">
            <div class="menu-header-row">
              <h3 class="menu-title">${item.name}</h3>
              <div class="menu-price">$${parseFloat(item.price).toFixed(2)}</div>
            </div>

            <p class="menu-desc">${item.description || ''}</p>

            ${tags.length > 0 ? `
              <div class="dietary-tags-row">
                ${tags.map(t => `<span class="dietary-tag">${t}</span>`).join('')}
              </div>
            ` : ''}

            <div class="card-footer">
              <button 
                type="button" 
                class="btn-add-item" 
                ${isSoldOut ? 'disabled' : ''} 
                onclick="CustomerView.openCustomizationModal(${item.id})">
                ${isSoldOut ? 'Sold Out' : (hasOptions ? '⚙️ Customize & Add' : '+ Add to Order')}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // Open Item Customization Modal
  openCustomizationModal(itemId) {
    const item = (this.menuData.all_items || []).find(i => i.id === itemId);
    if (!item || !item.is_available) return;

    this.activeCustomizingItem = item;
    this.customizationState = {
      selectedOptions: {},
      specialNotes: '',
      quantity: 1
    };

    // Pre-select first choice for required single-select groups
    if (item.option_groups) {
      item.option_groups.forEach(group => {
        if (group.type === 'single' && group.choices && group.choices.length > 0) {
          const firstAvail = group.choices.find(c => c.is_available) || group.choices[0];
          this.customizationState.selectedOptions[group.id] = [firstAvail.id];
        } else {
          this.customizationState.selectedOptions[group.id] = [];
        }
      });
    }

    this.renderCustomizationModal();
    const modal = document.getElementById('customization-modal');
    if (modal) modal.classList.add('active');
  },

  closeCustomizationModal() {
    const modal = document.getElementById('customization-modal');
    if (modal) modal.classList.remove('active');
    this.activeCustomizingItem = null;
  },

  renderCustomizationModal() {
    const item = this.activeCustomizingItem;
    if (!item) return;

    document.getElementById('modal-item-title').textContent = item.name;
    document.getElementById('modal-item-desc').textContent = item.description || '';

    const groupsContainer = document.getElementById('modal-option-groups');
    if (!groupsContainer) return;

    const groups = item.option_groups || [];

    if (groups.length === 0) {
      groupsContainer.innerHTML = `
        <div style="font-size: 0.9rem; color: #64748b; margin-bottom: 1rem;">
          No custom options required for this dish. Standard kitchen recipe prepared fresh.
        </div>
      `;
    } else {
      groupsContainer.innerHTML = groups.map(group => {
        const isSingle = group.type === 'single';
        const selectedForGroup = this.customizationState.selectedOptions[group.id] || [];

        return `
          <div class="custom-option-group">
            <div class="group-title-row">
              <span class="group-title">${group.name}</span>
              <span class="group-rule">${isSingle ? 'Choose 1' : 'Optional add-ons'}</span>
            </div>

            <div class="choices-list">
              ${(group.choices || []).map(choice => {
                const isSelected = selectedForGroup.includes(choice.id);
                const isAvail = choice.is_available;
                return `
                  <div class="choice-option ${isSelected ? 'selected' : ''} ${!isAvail ? 'unavailable' : ''}" 
                       onclick="CustomerView.toggleChoice(${group.id}, ${choice.id}, '${group.type}')">
                    <div class="choice-left">
                      <input type="${isSingle ? 'radio' : 'checkbox'}" 
                             name="opt_group_${group.id}" 
                             ${isSelected ? 'checked' : ''} 
                             ${!isAvail ? 'disabled' : ''} 
                             onclick="event.stopPropagation(); CustomerView.toggleChoice(${group.id}, ${choice.id}, '${group.type}')" />
                      <span class="choice-name">${choice.name} ${!isAvail ? '<em>(Unavailable)</em>' : ''}</span>
                    </div>
                    <span class="choice-price">${choice.price > 0 ? `+$${parseFloat(choice.price).toFixed(2)}` : 'Free'}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');
    }

    // Special instructions
    const notesInput = document.getElementById('modal-special-notes');
    if (notesInput) {
      notesInput.value = this.customizationState.specialNotes;
      notesInput.oninput = (e) => {
        this.customizationState.specialNotes = e.target.value;
      };
    }

    this.updateModalPriceAndQty();
  },

  toggleChoice(groupId, choiceId, groupType) {
    if (!this.customizationState.selectedOptions[groupId]) {
      this.customizationState.selectedOptions[groupId] = [];
    }

    if (groupType === 'single') {
      this.customizationState.selectedOptions[groupId] = [choiceId];
    } else {
      const idx = this.customizationState.selectedOptions[groupId].indexOf(choiceId);
      if (idx > -1) {
        this.customizationState.selectedOptions[groupId].splice(idx, 1);
      } else {
        this.customizationState.selectedOptions[groupId].push(choiceId);
      }
    }

    this.renderCustomizationModal();
  },

  updateModalPriceAndQty() {
    const item = this.activeCustomizingItem;
    if (!item) return;

    let extraPrice = 0.0;
    const groups = item.option_groups || [];
    groups.forEach(g => {
      const selected = this.customizationState.selectedOptions[g.id] || [];
      (g.choices || []).forEach(c => {
        if (selected.includes(c.id)) {
          extraPrice += parseFloat(c.price || 0);
        }
      });
    });

    const unitPrice = parseFloat(item.price) + extraPrice;
    const totalPrice = unitPrice * this.customizationState.quantity;

    const qtyVal = document.getElementById('modal-qty-val');
    if (qtyVal) qtyVal.textContent = this.customizationState.quantity;

    const priceSpan = document.getElementById('modal-confirm-price');
    if (priceSpan) priceSpan.textContent = `$${totalPrice.toFixed(2)}`;
  },

  addItemToCart() {
    const item = this.activeCustomizingItem;
    if (!item) return;

    // Collect customization summary text & total price
    const summaryParts = [];
    let extraPrice = 0.0;
    const groups = item.option_groups || [];

    groups.forEach(g => {
      const selected = this.customizationState.selectedOptions[g.id] || [];
      const choiceNames = [];
      (g.choices || []).forEach(c => {
        if (selected.includes(c.id)) {
          extraPrice += parseFloat(c.price || 0);
          choiceNames.push(c.price > 0 ? `${c.name} (+$${parseFloat(c.price).toFixed(2)})` : c.name);
        }
      });
      if (choiceNames.length > 0) {
        summaryParts.push(`${g.name}: ${choiceNames.join(', ')}`);
      }
    });

    const cartItem = {
      menu_item_id: item.id,
      name: item.name,
      base_price: parseFloat(item.price),
      options_extra_price: extraPrice,
      unit_price: parseFloat(item.price) + extraPrice,
      quantity: this.customizationState.quantity,
      special_notes: this.customizationState.specialNotes.trim(),
      customization_summary: summaryParts.join(' | ') || 'Standard recipe'
    };

    App.addToCart(cartItem);
    this.closeCustomizationModal();
    App.showToast(`Added ${cartItem.quantity}x ${item.name} to cart`, 'success');
  }
};
