/**
 * FleetWise - Frontend Client Application
 * Handles operational dashboards, assignment engine interactions, and live metrics.
 */

const state = {
  currentView: 'deliveries',
  deliveries: [],
  vehicles: [],
  drivers: [],
  stats: null,
  filters: {
    search: '',
    status: '',
    priority: ''
  }
};

const app = {
  async init() {
    this.bindEvents();
    this.setDefaultScheduledTime();
    await this.checkHealth();
    await this.refreshAll();

    // Periodic health & background sync every 15 seconds
    setInterval(() => this.checkHealth(), 15000);
  },

  bindEvents() {
    // Tab switching
    document.getElementById('tabDeliveries').addEventListener('click', () => this.switchView('deliveries'));
    document.getElementById('tabVehicles').addEventListener('click', () => this.switchView('vehicles'));
    document.getElementById('tabDrivers').addEventListener('click', () => this.switchView('drivers'));

    // Header buttons
    document.getElementById('btnRefreshAll').addEventListener('click', () => this.refreshAll());
    document.getElementById('btnSeedDemo').addEventListener('click', () => this.seedDemoData());
    document.getElementById('btnOpenNewDeliveryModal').addEventListener('click', () => this.openNewDeliveryModal());
    document.getElementById('btnCreateVehicleFromTab').addEventListener('click', () => this.openNewVehicleModal());
    document.getElementById('btnCreateDriverFromTab').addEventListener('click', () => this.openNewDriverModal());

    // Search and filters
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        this.renderCurrentView();
      }, 250);
    });

    document.getElementById('filterStatus').addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      this.renderCurrentView();
    });

    document.getElementById('filterPriority').addEventListener('change', (e) => {
      state.filters.priority = e.target.value;
      this.renderCurrentView();
    });

    document.getElementById('btnResetFilters').addEventListener('click', () => {
      state.filters.search = '';
      state.filters.status = '';
      state.filters.priority = '';
      document.getElementById('searchInput').value = '';
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterPriority').value = '';
      this.renderCurrentView();
    });

    // Form Submissions
    document.getElementById('formAssign').addEventListener('submit', (e) => this.handleAssignSubmit(e));
    document.getElementById('formNewDelivery').addEventListener('submit', (e) => this.handleNewDeliverySubmit(e));
    document.getElementById('formNewVehicle').addEventListener('submit', (e) => this.handleNewVehicleSubmit(e));
    document.getElementById('formNewDriver').addEventListener('submit', (e) => this.handleNewDriverSubmit(e));

    // Close modal on escape or background click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => this.closeModal(m.id));
      }
    });
  },

  setDefaultScheduledTime() {
    const input = document.getElementById('deliveryScheduledTime');
    if (input) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 60);
      input.value = now.toISOString().slice(0, 16);
    }
  },

  async checkHealth() {
    const badge = document.getElementById('systemHealthBadge');
    const text = document.getElementById('healthText');
    try {
      const res = await fetch('/health');
      if (res.ok) {
        badge.className = 'health-badge health-online';
        text.textContent = 'System Healthy';
      } else {
        badge.className = 'health-badge health-offline';
        text.textContent = 'Service Degraded';
      }
    } catch {
      badge.className = 'health-badge health-offline';
      text.textContent = 'Service Offline';
    }
  },

  async refreshAll() {
    await Promise.all([
      this.fetchStats(),
      this.fetchDeliveries(),
      this.fetchVehicles(),
      this.fetchDrivers()
    ]);
    this.renderCurrentView();
  },

  async fetchStats() {
    try {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch dashboard stats');
      const data = await res.json();
      state.stats = data;
      this.renderStats(data);
    } catch (err) {
      console.error(err);
    }
  },

  renderStats(stats) {
    if (!stats) return;

    // Vehicles KPI
    document.getElementById('kpiTotalVehicles').textContent = stats.vehicles.total;
    document.getElementById('kpiAvailableVehicles').textContent = stats.vehicles.available;
    document.getElementById('kpiAssignedVehicles').textContent = stats.vehicles.assigned;
    document.getElementById('kpiMaintenanceVehicles').textContent = stats.vehicles.maintenance;

    // Drivers KPI
    document.getElementById('kpiTotalDrivers').textContent = stats.drivers.total;
    document.getElementById('kpiAvailableDrivers').textContent = stats.drivers.available;
    document.getElementById('kpiAssignedDrivers').textContent = stats.drivers.assigned;
    document.getElementById('kpiUnavailableDrivers').textContent = stats.drivers.unavailable;

    // Deliveries KPI
    document.getElementById('kpiPendingDeliveries').textContent = stats.deliveries.pending;
    document.getElementById('kpiActiveDeliveries').textContent = stats.deliveries.active;
    document.getElementById('kpiAssignedDel').textContent = stats.deliveries.assigned;
    document.getElementById('kpiInTransitDel').textContent = stats.deliveries.in_transit;
    document.getElementById('kpiCompletedDeliveries').textContent = stats.deliveries.completed;
    document.getElementById('kpiCancelledDeliveries').textContent = stats.deliveries.cancelled;
    document.getElementById('kpiUtilizationRate').textContent = `${stats.vehicles.utilization_rate}%`;

    // Tab counts
    document.getElementById('countTabDeliveries').textContent = stats.deliveries.total;
    document.getElementById('countTabVehicles').textContent = stats.vehicles.total;
    document.getElementById('countTabDrivers').textContent = stats.drivers.total;

    // Render Status Progress Distribution Bar
    const total = stats.deliveries.total;
    if (total > 0) {
      const pPend = ((stats.deliveries.pending / total) * 100).toFixed(1);
      const pAssg = ((stats.deliveries.assigned / total) * 100).toFixed(1);
      const pTrans = ((stats.deliveries.in_transit / total) * 100).toFixed(1);
      const pDone = ((stats.deliveries.completed / total) * 100).toFixed(1);
      const pCanc = ((stats.deliveries.cancelled / total) * 100).toFixed(1);

      document.getElementById('barPending').style.width = `${pPend}%`;
      document.getElementById('barAssigned').style.width = `${pAssg}%`;
      document.getElementById('barInTransit').style.width = `${pTrans}%`;
      document.getElementById('barDelivered').style.width = `${pDone}%`;
      document.getElementById('barCancelled').style.width = `${pCanc}%`;

      document.getElementById('barPending').title = `Pending: ${stats.deliveries.pending} (${pPend}%)`;
      document.getElementById('barAssigned').title = `Assigned: ${stats.deliveries.assigned} (${pAssg}%)`;
      document.getElementById('barInTransit').title = `In Transit: ${stats.deliveries.in_transit} (${pTrans}%)`;
      document.getElementById('barDelivered').title = `Delivered: ${stats.deliveries.completed} (${pDone}%)`;
      document.getElementById('barCancelled').title = `Cancelled: ${stats.deliveries.cancelled} (${pCanc}%)`;
    } else {
      document.getElementById('barPending').style.width = '0%';
      document.getElementById('barAssigned').style.width = '0%';
      document.getElementById('barInTransit').style.width = '0%';
      document.getElementById('barDelivered').style.width = '0%';
      document.getElementById('barCancelled').style.width = '0%';
    }
  },

  async fetchDeliveries() {
    try {
      const res = await fetch('/deliveries');
      if (!res.ok) throw new Error('Failed to fetch deliveries');
      state.deliveries = await res.json();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async fetchVehicles() {
    try {
      const res = await fetch('/vehicles');
      if (!res.ok) throw new Error('Failed to fetch vehicles');
      state.vehicles = await res.json();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async fetchDrivers() {
    try {
      const res = await fetch('/drivers');
      if (!res.ok) throw new Error('Failed to fetch drivers');
      state.drivers = await res.json();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  switchView(viewName) {
    state.currentView = viewName;

    // Update tab styling
    document.getElementById('tabDeliveries').classList.toggle('active', viewName === 'deliveries');
    document.getElementById('tabVehicles').classList.toggle('active', viewName === 'vehicles');
    document.getElementById('tabDrivers').classList.toggle('active', viewName === 'drivers');

    // Toggle panels
    document.getElementById('viewDeliveries').style.display = viewName === 'deliveries' ? 'block' : 'none';
    document.getElementById('viewVehicles').style.display = viewName === 'vehicles' ? 'block' : 'none';
    document.getElementById('viewDrivers').style.display = viewName === 'drivers' ? 'block' : 'none';

    // Context actions
    document.getElementById('btnCreateVehicleFromTab').style.display = viewName === 'vehicles' ? 'inline-flex' : 'none';
    document.getElementById('btnCreateDriverFromTab').style.display = viewName === 'drivers' ? 'inline-flex' : 'none';

    // Adjust filter controls for non-delivery views
    document.getElementById('filterPriorityGroup').style.display = viewName === 'deliveries' ? 'flex' : 'none';

    this.renderCurrentView();
  },

  renderCurrentView() {
    if (state.currentView === 'deliveries') {
      this.renderDeliveriesTable();
    } else if (state.currentView === 'vehicles') {
      this.renderVehiclesTable();
    } else if (state.currentView === 'drivers') {
      this.renderDriversTable();
    }
  },

  renderDeliveriesTable() {
    const tbody = document.getElementById('deliveriesTableBody');
    const emptyState = document.getElementById('deliveriesEmptyState');
    tbody.innerHTML = '';

    const query = state.filters.search.toLowerCase();
    const statusFilter = state.filters.status;
    const priorityFilter = state.filters.priority;

    const filtered = state.deliveries.filter(d => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (priorityFilter && d.priority !== priorityFilter) return false;
      if (query) {
        const matchesId = d.id.toLowerCase().includes(query);
        const matchesPickup = d.pickup_address.toLowerCase().includes(query);
        const matchesDropoff = d.dropoff_address.toLowerCase().includes(query);
        const matchesVeh = d.assignment?.vehicle?.registration_number?.toLowerCase().includes(query);
        const matchesDrv = d.assignment?.driver?.name?.toLowerCase().includes(query);
        if (!matchesId && !matchesPickup && !matchesDropoff && !matchesVeh && !matchesDrv) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    filtered.forEach(d => {
      const tr = document.createElement('tr');
      const isPending = d.status === 'pending';
      const isAssigned = d.status === 'assigned';
      const isInTransit = d.status === 'in_transit';
      const isDelivered = d.status === 'delivered';
      const isCancelled = d.status === 'cancelled';

      const schedDate = new Date(d.scheduled_time).toLocaleString();

      const vehInfo = d.assignment ? 
        `<strong>${d.assignment.vehicle.registration_number}</strong> <span class="text-muted text-sm">(${d.assignment.vehicle.type})</span>` :
        `<span class="text-muted">—</span>`;

      const drvInfo = d.assignment ?
        `<strong>${d.assignment.driver.name}</strong> <span class="text-muted text-sm">${d.assignment.driver.phone}</span>` :
        `<span class="text-muted">—</span>`;

      let actionButtons = '';
      if (isPending) {
        actionButtons = `
          <button class="btn btn-action-assign" onclick="app.openAssignModal('${d.id}')">Assign Resource</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
        `;
      } else if (isAssigned) {
        actionButtons = `
          <button class="btn btn-action-transit" onclick="app.transitionStatus('${d.id}', 'in_transit')">Dispatch</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else if (isInTransit) {
        actionButtons = `
          <button class="btn btn-action-deliver" onclick="app.transitionStatus('${d.id}', 'delivered')">Mark Delivered</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else {
        actionButtons = `
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit Log</button>
        `;
      }

      tr.innerHTML = `
        <td><span class="id-code">${d.id}</span></td>
        <td>
          <div style="font-weight: 600;">${this.escapeHtml(d.pickup_address)}</div>
          <div class="text-muted text-sm">➔ ${this.escapeHtml(d.dropoff_address)}</div>
        </td>
        <td><span class="text-sm">${schedDate}</span></td>
        <td><span class="priority-${d.priority}">${d.priority.toUpperCase()}</span></td>
        <td><span class="badge badge-${d.status}">${d.status.replace('_', ' ')}</span></td>
        <td>${vehInfo}</td>
        <td>${drvInfo}</td>
        <td class="text-right"><div class="table-actions">${actionButtons}</div></td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderVehiclesTable() {
    const tbody = document.getElementById('vehiclesTableBody');
    const emptyState = document.getElementById('vehiclesEmptyState');
    tbody.innerHTML = '';

    const query = state.filters.search.toLowerCase();
    const statusFilter = state.filters.status;

    const filtered = state.vehicles.filter(v => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (query) {
        const matchesReg = v.registration_number.toLowerCase().includes(query);
        const matchesType = v.type.toLowerCase().includes(query);
        const matchesId = v.id.toLowerCase().includes(query);
        if (!matchesReg && !matchesType && !matchesId) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    filtered.forEach(v => {
      const tr = document.createElement('tr');
      const activeDeliveryInfo = v.active_delivery ?
        `<span class="badge badge-in_transit">Delivery ${v.active_delivery.delivery_id}</span>
         <div class="text-sm text-muted">${v.active_delivery.pickup_address} ➔ ${v.active_delivery.dropoff_address}</div>` :
        `<span class="text-muted">None</span>`;

      // Status selector
      const statusSelect = `
        <select class="select-input text-sm" onchange="app.handleVehicleStatusChange('${v.id}', this.value)" ${v.status === 'assigned' ? 'title="Assigned via active delivery. Complete or cancel delivery to release."' : ''}>
          <option value="available" ${v.status === 'available' ? 'selected' : ''}>Available</option>
          <option value="assigned" ${v.status === 'assigned' ? 'selected' : ''} disabled>Assigned</option>
          <option value="maintenance" ${v.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
          <option value="inactive" ${v.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      `;

      tr.innerHTML = `
        <td><span class="id-code">${v.id}</span></td>
        <td><strong>${this.escapeHtml(v.registration_number)}</strong></td>
        <td>${this.escapeHtml(v.type)}</td>
        <td>${v.capacity.toLocaleString()} kg</td>
        <td><span class="badge badge-${v.status}">${v.status}</span></td>
        <td>${activeDeliveryInfo}</td>
        <td>${statusSelect}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderDriversTable() {
    const tbody = document.getElementById('driversTableBody');
    const emptyState = document.getElementById('driversEmptyState');
    tbody.innerHTML = '';

    const query = state.filters.search.toLowerCase();
    const statusFilter = state.filters.status;

    const filtered = state.drivers.filter(d => {
      if (statusFilter && d.availability_status !== statusFilter) return false;
      if (query) {
        const matchesName = d.name.toLowerCase().includes(query);
        const matchesPhone = d.phone.toLowerCase().includes(query);
        const matchesId = d.id.toLowerCase().includes(query);
        if (!matchesName && !matchesPhone && !matchesId) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    filtered.forEach(d => {
      const tr = document.createElement('tr');
      const activeDeliveryInfo = d.active_delivery ?
        `<span class="badge badge-in_transit">Delivery ${d.active_delivery.delivery_id}</span>
         <div class="text-sm text-muted">${d.active_delivery.pickup_address} ➔ ${d.active_delivery.dropoff_address}</div>` :
        `<span class="text-muted">None</span>`;

      // Status selector
      const statusSelect = `
        <select class="select-input text-sm" onchange="app.handleDriverStatusChange('${d.id}', this.value)" ${d.availability_status === 'assigned' ? 'title="Assigned via active delivery. Complete or cancel delivery to release."' : ''}>
          <option value="available" ${d.availability_status === 'available' ? 'selected' : ''}>Available</option>
          <option value="assigned" ${d.availability_status === 'assigned' ? 'selected' : ''} disabled>Assigned</option>
          <option value="unavailable" ${d.availability_status === 'unavailable' ? 'selected' : ''}>Unavailable</option>
        </select>
      `;

      tr.innerHTML = `
        <td><span class="id-code">${d.id}</span></td>
        <td><strong>${this.escapeHtml(d.name)}</strong></td>
        <td><span class="text-sm">${this.escapeHtml(d.phone)}</span></td>
        <td><span class="badge badge-${d.availability_status}">${d.availability_status}</span></td>
        <td>${activeDeliveryInfo}</td>
        <td>${statusSelect}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  openAssignModal(deliveryId) {
    const delivery = state.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return;

    document.getElementById('assignDeliveryId').value = deliveryId;
    document.getElementById('assignConflictNotice').style.display = 'none';

    // Preview
    document.getElementById('assignDeliveryPreview').innerHTML = `
      <div style="font-weight: 700; margin-bottom: 0.25rem;">Delivery: <span class="id-code">${delivery.id}</span> [${delivery.priority.toUpperCase()}]</div>
      <div class="preview-route">
        <div><strong>Pickup:</strong> ${this.escapeHtml(delivery.pickup_address)}</div>
        <div><strong>Dropoff:</strong> ${this.escapeHtml(delivery.dropoff_address)}</div>
        <div><strong>Scheduled:</strong> ${new Date(delivery.scheduled_time).toLocaleString()}</div>
      </div>
    `;

    // Filter eligible available vehicles
    const vehSelect = document.getElementById('assignVehicleSelect');
    vehSelect.innerHTML = '<option value="">-- Choose an Available Vehicle --</option>';
    const availableVehicles = state.vehicles.filter(v => v.status === 'available' && !v.active_delivery);
    if (availableVehicles.length === 0) {
      vehSelect.innerHTML += '<option value="" disabled>⚠️ No available vehicles in fleet</option>';
    } else {
      availableVehicles.forEach(v => {
        vehSelect.innerHTML += `<option value="${v.id}">${v.registration_number} (${v.type} — ${v.capacity} kg)</option>`;
      });
    }

    // Filter eligible available drivers
    const drvSelect = document.getElementById('assignDriverSelect');
    drvSelect.innerHTML = '<option value="">-- Choose an Available Driver --</option>';
    const availableDrivers = state.drivers.filter(d => d.availability_status === 'available' && !d.active_delivery);
    if (availableDrivers.length === 0) {
      drvSelect.innerHTML += '<option value="" disabled>⚠️ No available drivers in roster</option>';
    } else {
      availableDrivers.forEach(d => {
        drvSelect.innerHTML += `<option value="${d.id}">${d.name} (${d.phone})</option>`;
      });
    }

    this.openModal('modalAssign');
  },

  async handleAssignSubmit(e) {
    e.preventDefault();
    const deliveryId = document.getElementById('assignDeliveryId').value;
    const vehicleId = document.getElementById('assignVehicleSelect').value;
    const driverId = document.getElementById('assignDriverSelect').value;
    const conflictNotice = document.getElementById('assignConflictNotice');

    if (!vehicleId || !driverId) {
      conflictNotice.textContent = 'Please select both an available vehicle and an available driver.';
      conflictNotice.style.display = 'block';
      return;
    }

    try {
      const res = await fetch(`/deliveries/${deliveryId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, driver_id: driverId })
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Assignment failed');
      }

      this.showToast('Resource assigned successfully!', 'success');
      this.closeModal('modalAssign');
      await this.refreshAll();
    } catch (err) {
      conflictNotice.textContent = `Assignment Conflict: ${err.message}`;
      conflictNotice.style.display = 'block';
      this.showToast(err.message, 'error');
    }
  },

  async transitionStatus(deliveryId, newStatus) {
    const confirmMessage = newStatus === 'cancelled' ?
      'Are you sure you want to cancel this delivery? Any assigned resources will be safely released.' :
      `Advance delivery status to '${newStatus.replace('_', ' ')}'?`;

    if (!confirm(confirmMessage)) return;

    try {
      const res = await fetch(`/deliveries/${deliveryId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Status transition failed');
      }

      this.showToast(`Delivery transitioned to ${newStatus.replace('_', ' ')}`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async viewDeliveryDetails(deliveryId) {
    const delivery = state.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return;

    document.getElementById('modalDetailsTitle').textContent = `Delivery Details: ${delivery.id}`;
    document.getElementById('modalDetailsSubtitle').textContent = `Priority: ${delivery.priority.toUpperCase()} | Status: ${delivery.status.toUpperCase()}`;

    // Fetch assignment history
    let historyHtml = '<p class="text-muted">Loading audit log...</p>';
    try {
      const res = await fetch(`/deliveries/${deliveryId}/assignments`);
      if (res.ok) {
        const history = await res.json();
        if (history.length === 0) {
          historyHtml = '<p class="text-muted">No assignment records on file.</p>';
        } else {
          historyHtml = `
            <table class="data-table text-sm" style="margin-top: 0.5rem;">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Assigned At</th>
                  <th>Released At</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(h => `
                  <tr>
                    <td><strong>${h.vehicle_registration_number}</strong> (${h.vehicle_type})</td>
                    <td><strong>${h.driver_name}</strong> (${h.driver_phone})</td>
                    <td>${new Date(h.assigned_at).toLocaleString()}</td>
                    <td>${h.released_at ? new Date(h.released_at).toLocaleString() : '—'}</td>
                    <td>${h.is_active ? '<span class="badge badge-assigned">Active</span>' : '<span class="badge badge-delivered">Released</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }
      }
    } catch (err) {
      historyHtml = `<p class="text-danger">Failed to load assignment logs: ${err.message}</p>`;
    }

    const content = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
        <div class="delivery-preview-box">
          <div style="font-weight: 700; color: var(--text-secondary); margin-bottom: 0.4rem;">Route Information</div>
          <div><strong>Pickup:</strong> ${this.escapeHtml(delivery.pickup_address)}</div>
          <div><strong>Dropoff:</strong> ${this.escapeHtml(delivery.dropoff_address)}</div>
          <div><strong>Scheduled:</strong> ${new Date(delivery.scheduled_time).toLocaleString()}</div>
          ${delivery.notes ? `<div style="margin-top: 0.25rem;"><strong>Notes:</strong> ${this.escapeHtml(delivery.notes)}</div>` : ''}
        </div>
        <div class="delivery-preview-box">
          <div style="font-weight: 700; color: var(--text-secondary); margin-bottom: 0.4rem;">Active Allocation</div>
          ${delivery.assignment ? `
            <div><strong>Vehicle:</strong> ${delivery.assignment.vehicle.registration_number} (${delivery.assignment.vehicle.type})</div>
            <div><strong>Driver:</strong> ${delivery.assignment.driver.name} (${delivery.assignment.driver.phone})</div>
            <div><strong>Assigned Since:</strong> ${new Date(delivery.assignment.assigned_at).toLocaleString()}</div>
          ` : '<p class="text-muted">No vehicle or driver currently assigned.</p>'}
        </div>
      </div>
      <div>
        <h4 style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.35rem;">Audit & Assignment History</h4>
        ${historyHtml}
      </div>
    `;

    document.getElementById('modalDetailsContent').innerHTML = content;
    this.openModal('modalDetails');
  },

  async handleVehicleStatusChange(vehicleId, newStatus) {
    try {
      const res = await fetch(`/vehicles/${vehicleId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Failed to update vehicle status');
      }

      this.showToast(`Vehicle status changed to ${newStatus}`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
      await this.refreshAll(); // Refresh to restore previous dropdown select
    }
  },

  async handleDriverStatusChange(driverId, newStatus) {
    try {
      const res = await fetch(`/drivers/${driverId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Failed to update driver status');
      }

      this.showToast(`Driver status changed to ${newStatus}`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
      await this.refreshAll();
    }
  },

  async handleNewDeliverySubmit(e) {
    e.preventDefault();
    const payload = {
      pickup_address: document.getElementById('deliveryPickup').value.trim(),
      dropoff_address: document.getElementById('deliveryDropoff').value.trim(),
      scheduled_time: new Date(document.getElementById('deliveryScheduledTime').value).toISOString(),
      priority: document.getElementById('deliveryPriority').value,
      notes: document.getElementById('deliveryNotes').value.trim()
    };

    try {
      const res = await fetch('/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to create delivery');

      this.showToast(`Delivery ${body.id} created!`, 'success');
      this.closeModal('modalNewDelivery');
      document.getElementById('formNewDelivery').reset();
      this.setDefaultScheduledTime();
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleNewVehicleSubmit(e) {
    e.preventDefault();
    const payload = {
      registration_number: document.getElementById('vehicleReg').value.trim(),
      type: document.getElementById('vehicleType').value.trim(),
      capacity: parseFloat(document.getElementById('vehicleCapacity').value),
      status: document.getElementById('vehicleInitialStatus').value
    };

    try {
      const res = await fetch('/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to create vehicle');

      this.showToast(`Vehicle ${body.registration_number} registered!`, 'success');
      this.closeModal('modalNewVehicle');
      document.getElementById('formNewVehicle').reset();
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleNewDriverSubmit(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('driverName').value.trim(),
      phone: document.getElementById('driverPhone').value.trim(),
      availability_status: document.getElementById('driverInitialStatus').value
    };

    try {
      const res = await fetch('/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to create driver');

      this.showToast(`Driver ${body.name} registered!`, 'success');
      this.closeModal('modalNewDriver');
      document.getElementById('formNewDriver').reset();
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async seedDemoData() {
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const body = await res.json();
      this.showToast(body.message, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  },

  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  },

  openNewDeliveryModal() {
    this.setDefaultScheduledTime();
    this.openModal('modalNewDelivery');
  },

  openNewVehicleModal() {
    this.openModal('modalNewVehicle');
  },

  openNewDriverModal() {
    this.openModal('modalNewDriver');
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `
      <span>${icon}</span>
      <div style="flex: 1;">${this.escapeHtml(message)}</div>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#94a3b8;">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.app = app;
  app.init();
});

