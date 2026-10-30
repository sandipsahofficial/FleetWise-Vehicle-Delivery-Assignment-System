/**
 * FleetWise - Frontend Client Application & Dispatcher Dashboard
 * Connected directly to backend REST endpoints.
 */

const state = {
  currentView: 'deliveries',
  userRole: 'fleet_manager',
  currentUser: null,
  accessToken: null, // kept strictly in memory, never in localStorage!
  deliveries: [],
  vehicles: [],
  drivers: [],
  queue: [],
  analytics: null,
  auditLogs: [],
  stats: null,
  filters: {
    search: '',
    status: '',
    priority: ''
  },
  sorting: {
    column: 'time',
    ascending: true
  },
  pagination: {
    page: 1,
    pageSize: 10
  }
};

const app = {
  async init() {
    this.bindEvents();
    this.setDefaultScheduledTime();

    // Check if refresh token exists in localStorage to restore session
    const hasRefreshToken = Boolean(localStorage.getItem('fleetwise_refresh_token'));
    if (hasRefreshToken) {
      const refreshed = await this.silentRefresh();
      if (!refreshed) {
        this.showLoginOverlay();
      }
    } else {
      this.showLoginOverlay();
    }

    await this.checkHealth();
    await this.refreshAll();

    // Auto health check every 15s
    setInterval(() => this.checkHealth(), 15000);
  },

  showLoginOverlay() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  },

  hideLoginOverlay() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  },

  async handleLoginFormSubmit(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const errorNotice = document.getElementById('loginErrorNotice');
    const submitBtn = document.getElementById('btnSubmitLogin');

    if (errorNotice) errorNotice.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed. Please check your credentials.');
      }

      // Keep access token in memory only!
      state.accessToken = data.accessToken;
      state.currentUser = data.user;
      state.userRole = data.user.role;

      // Only refresh token goes in localStorage
      localStorage.setItem('fleetwise_refresh_token', data.refreshToken);

      passwordInput.value = '';
      this.hideLoginOverlay();
      this.updateUserUI();
      this.showToast(`Welcome back, ${data.user.username}!`, 'success');
      await this.refreshAll();
    } catch (err) {
      if (errorNotice) {
        errorNotice.textContent = err.message;
        errorNotice.style.display = 'block';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  async silentRefresh() {
    const refreshToken = localStorage.getItem('fleetwise_refresh_token');
    if (!refreshToken) return false;

    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (!res.ok) {
        localStorage.removeItem('fleetwise_refresh_token');
        state.accessToken = null;
        state.currentUser = null;
        return false;
      }

      const data = await res.json();
      state.accessToken = data.accessToken;
      state.currentUser = data.user;
      state.userRole = data.user.role;

      // Rotate refresh token in localStorage
      localStorage.setItem('fleetwise_refresh_token', data.refreshToken);
      this.updateUserUI();
      return true;
    } catch (_) {
      return false;
    }
  },

  async logout() {
    const refreshToken = localStorage.getItem('fleetwise_refresh_token');
    try {
      if (refreshToken) {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (_) {}

    localStorage.removeItem('fleetwise_refresh_token');
    state.accessToken = null;
    state.currentUser = null;
    state.userRole = 'dispatcher';
    this.updateUserUI();
    this.showLoginOverlay();
    this.showToast('Signed out successfully.', 'info');
  },

  updateUserUI() {
    const username = state.currentUser ? state.currentUser.username : 'Guest';
    const role = state.currentUser ? state.currentUser.role : 'None';

    const headerName = document.getElementById('headerUserName');
    const headerRole = document.getElementById('headerUserRole');
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarRole = document.getElementById('sidebarUserRole');
    const sidebarAvatar = document.getElementById('sidebarUserAvatar');

    if (headerName) headerName.textContent = username;
    if (headerRole) headerRole.textContent = role;
    if (sidebarName) sidebarName.textContent = username;
    if (sidebarRole) sidebarRole.textContent = role;
    if (sidebarAvatar) sidebarAvatar.textContent = username.charAt(0).toUpperCase();

    // Role-based UI visibility enforcement
    const isAdmin = role === 'admin' || role === 'fleet_manager';
    const isDriver = role === 'driver';

    // Context add buttons
    const btnVeh = document.getElementById('btnHeaderCreateVehicle');
    if (btnVeh) btnVeh.style.display = isAdmin ? 'inline-flex' : 'none';
    const btnDrv = document.getElementById('btnHeaderCreateDriver');
    if (btnDrv) btnDrv.style.display = isAdmin ? 'inline-flex' : 'none';

    // Hide vehicle/driver sections for pure drivers
    const fleetSection = document.getElementById('sidebarSectionFleet');
    if (fleetSection) fleetSection.style.display = isDriver ? 'none' : 'block';
    const tabVeh = document.getElementById('tabVehicles');
    if (tabVeh) tabVeh.style.display = isDriver ? 'none' : 'flex';
    const tabDrv = document.getElementById('tabDrivers');
    if (tabDrv) tabDrv.style.display = isDriver ? 'none' : 'flex';
    const tabQueue = document.getElementById('tabQueue');
    if (tabQueue) tabQueue.style.display = isDriver ? 'none' : 'flex';
  },

  bindEvents() {
    // Sidebar nav items have onclick="app.switchView(...)" inline; also wire via JS for robustness
    document.getElementById('tabDeliveries').addEventListener('click', () => this.switchView('deliveries'));
    document.getElementById('tabBoard').addEventListener('click', () => this.switchView('board'));
    document.getElementById('tabVehicles').addEventListener('click', () => this.switchView('vehicles'));
    document.getElementById('tabDrivers').addEventListener('click', () => this.switchView('drivers'));
    document.getElementById('tabQueue').addEventListener('click', () => this.switchView('queue'));
    document.getElementById('tabAnalytics').addEventListener('click', () => this.switchView('analytics'));
    document.getElementById('tabAudit').addEventListener('click', () => this.switchView('audit'));

    // Top bar buttons
    document.getElementById('btnRefreshAll').addEventListener('click', () => this.refreshAll());
    document.getElementById('btnSeedDemo').addEventListener('click', () => this.seedDemoData());
    document.getElementById('btnOpenNewDeliveryModal').addEventListener('click', () => this.openNewDeliveryModal());

    // Mobile sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appSidebar    = document.getElementById('appSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarToggle && appSidebar) {
      sidebarToggle.addEventListener('click', () => {
        appSidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('open');
      });
      sidebarOverlay.addEventListener('click', () => {
        appSidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
      });
    }

    // Search and filters
    const searchInput = document.getElementById('searchInput');
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.filters.search = e.target.value.trim();
        state.pagination.page = 1;
        if (viewName === 'livemap') {
      this.initOrRefreshMap();
    }
    this.renderCurrentView();
      }, 250);
    });

    document.getElementById('filterStatus').addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      state.pagination.page = 1;
      this.renderCurrentView();
    });

    document.getElementById('filterPriority').addEventListener('change', (e) => {
      state.filters.priority = e.target.value;
      state.pagination.page = 1;
      this.renderCurrentView();
    });

    document.getElementById('btnResetFilters').addEventListener('click', () => {
      state.filters.search = '';
      state.filters.status = '';
      state.filters.priority = '';
      state.pagination.page = 1;
      document.getElementById('searchInput').value = '';
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterPriority').value = '';
      this.renderCurrentView();
    });

    // Form Submissions
    const loginForm = document.getElementById('formLogin');
    if (loginForm) loginForm.addEventListener('submit', (e) => this.handleLoginFormSubmit(e));
    document.getElementById('formAssign').addEventListener('submit', (e) => this.handleAssignSubmit(e));
    document.getElementById('formNewDelivery').addEventListener('submit', (e) => this.handleDeliveryFormSubmit(e));
    document.getElementById('formNewVehicle').addEventListener('submit', (e) => this.handleVehicleFormSubmit(e));
    document.getElementById('formNewDriver').addEventListener('submit', (e) => this.handleDriverFormSubmit(e));

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
    const qBadge = document.getElementById('countTabQueue');
    if (qBadge) qBadge.textContent = stats.deliveries.pending;

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
      const res = await this.apiFetch('/deliveries');
      if (!res.ok) throw new Error('Failed to fetch deliveries');
      const data = await res.json();
      state.deliveries = Array.isArray(data) ? data : (data.data || []);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async fetchVehicles() {
    try {
      const res = await this.apiFetch('/vehicles');
      if (!res.ok) throw new Error('Failed to fetch vehicles');
      const data = await res.json();
      state.vehicles = Array.isArray(data) ? data : (data.data || []);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async fetchDrivers() {
    try {
      const res = await this.apiFetch('/drivers');
      if (!res.ok) throw new Error('Failed to fetch drivers');
      const data = await res.json();
      state.drivers = Array.isArray(data) ? data : (data.data || []);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async apiFetch(url, options = {}) {
    const headers = {
      'X-User-Role': state.userRole,
      ...(options.headers || {})
    };

    // If access token is held in memory, include Bearer header
    if (state.accessToken) {
      headers['Authorization'] = `Bearer ${state.accessToken}`;
    }

    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let response = await fetch(url, { ...options, headers });

    // Handle 401: attempt one silent refresh if a refresh token is present
    if (response.status === 401 && localStorage.getItem('fleetwise_refresh_token')) {
      const refreshed = await this.silentRefresh();
      if (refreshed && state.accessToken) {
        // Retry the original request once with fresh token
        headers['Authorization'] = `Bearer ${state.accessToken}`;
        response = await fetch(url, { ...options, headers });
      } else {
        // Refresh failed: prompt login
        this.showLoginOverlay();
      }
    }

    return response;
  },

  setUserRole(role) {
    state.userRole = role;
    this.showToast(`Active role set to: ${role === 'fleet_manager' ? 'Fleet Manager (Full Admin)' : 'Dispatcher (Logistics)'}`, 'info');
  },

  switchView(viewName) {
    
    state.currentView = viewName;

    // Tabs
    document.getElementById('tabDeliveries').classList.toggle('active', viewName === 'deliveries');
    document.getElementById('tabBoard').classList.toggle('active', viewName === 'board');
    document.getElementById('tabVehicles').classList.toggle('active', viewName === 'vehicles');
    document.getElementById('tabDrivers').classList.toggle('active', viewName === 'drivers');
    document.getElementById('tabQueue').classList.toggle('active', viewName === 'queue');
    document.getElementById('tabAnalytics').classList.toggle('active', viewName === 'analytics');
    document.getElementById('tabAudit').classList.toggle('active', viewName === 'audit');

    // Panels
    document.getElementById('viewDeliveries').style.display = viewName === 'deliveries' ? 'block' : 'none';
    document.getElementById('viewBoard').style.display = viewName === 'board' ? 'block' : 'none';
    document.getElementById('viewVehicles').style.display = viewName === 'vehicles' ? 'block' : 'none';
    document.getElementById('viewDrivers').style.display = viewName === 'drivers' ? 'block' : 'none';
    document.getElementById('viewQueue').style.display = viewName === 'queue' ? 'block' : 'none';
    document.getElementById('viewAnalytics').style.display = viewName === 'analytics' ? 'block' : 'none';
    document.getElementById('viewAudit').style.display = viewName === 'audit' ? 'block' : 'none';

    // Context action buttons
    document.getElementById('btnCreateVehicleFromTab').style.display = viewName === 'vehicles' ? 'inline-flex' : 'none';
    document.getElementById('btnCreateDriverFromTab').style.display = viewName === 'drivers' ? 'inline-flex' : 'none';

    // Filters visibility
    document.getElementById('filterPriorityGroup').style.display = (viewName === 'deliveries' || viewName === 'board') ? 'flex' : 'none';

    this.renderCurrentView();
  },

  renderCurrentView() {
    if (state.currentView === 'deliveries') {
      this.renderDeliveriesTable();
    } else if (state.currentView === 'board') {
      this.renderBoard();
    } else if (state.currentView === 'vehicles') {
      this.renderVehiclesTable();
    } else if (state.currentView === 'drivers') {
      this.renderDriversTable();
    } else if (state.currentView === 'queue') {
      this.loadPriorityQueue();
    } else if (state.currentView === 'analytics') {
      this.loadPerformanceAnalytics();
    } else if (state.currentView === 'audit') {
      this.loadAuditLogs();
    }
  },

  getFilteredDeliveries() {
    const query = state.filters.search.toLowerCase();
    const statusFilter = state.filters.status;
    const priorityFilter = state.filters.priority;

    let list = state.deliveries.filter(d => {
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

    // Sort
    const col = state.sorting.column;
    const asc = state.sorting.ascending;
    list.sort((a, b) => {
      let vA = a[col] || '';
      let vB = b[col] || '';
      if (col === 'time') {
        vA = new Date(a.scheduled_time).getTime();
        vB = new Date(b.scheduled_time).getTime();
      }
      if (vA < vB) return asc ? -1 : 1;
      if (vA > vB) return asc ? 1 : -1;
      return 0;
    });

    return list;
  },

  sortDeliveries(column) {
    if (state.sorting.column === column) {
      state.sorting.ascending = !state.sorting.ascending;
    } else {
      state.sorting.column = column;
      state.sorting.ascending = true;
    }
    this.renderDeliveriesTable();
  },

  prevPage(type) {
    if (state.pagination.page > 1) {
      state.pagination.page--;
      this.renderDeliveriesTable();
    }
  },

  nextPage(type) {
    const filtered = this.getFilteredDeliveries();
    const maxPage = Math.ceil(filtered.length / state.pagination.pageSize) || 1;
    if (state.pagination.page < maxPage) {
      state.pagination.page++;
      this.renderDeliveriesTable();
    }
  },

  renderDeliveriesTable() {
    const tbody = document.getElementById('deliveriesTableBody');
    const emptyState = document.getElementById('deliveriesEmptyState');
    tbody.innerHTML = '';

    const filtered = this.getFilteredDeliveries();

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      document.getElementById('deliveriesPaginationBar').style.display = 'none';
      return;
    }
    emptyState.style.display = 'none';
    document.getElementById('deliveriesPaginationBar').style.display = 'flex';

    // Pagination
    const total = filtered.length;
    const pageSize = state.pagination.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;
    if (state.pagination.page > totalPages) state.pagination.page = totalPages;
    const startIdx = (state.pagination.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, total);
    const paged = filtered.slice(startIdx, endIdx);

    document.getElementById('delPaginationInfo').textContent = `Showing ${startIdx + 1}-${endIdx} of ${total} deliveries`;
    document.getElementById('delPageIndicator').textContent = `Page ${state.pagination.page} of ${totalPages}`;
    document.getElementById('btnDelPrev').disabled = state.pagination.page <= 1;
    document.getElementById('btnDelNext').disabled = state.pagination.page >= totalPages;

    paged.forEach(d => {
      const tr = document.createElement('tr');
      const isPending = d.status === 'pending';
      const isAssigned = d.status === 'assigned';
      const isInTransit = d.status === 'in_transit';

      const schedDate = new Date(d.scheduled_time).toLocaleString();

      const vehInfo = d.assignment ? 
        `<strong>${this.escapeHtml(d.assignment.vehicle.registration_number)}</strong> <span class="text-muted text-sm">(${this.escapeHtml(d.assignment.vehicle.type)})</span>` :
        `<span class="text-muted">—</span>`;

      const drvInfo = d.assignment ?
        `<strong>${this.escapeHtml(d.assignment.driver.name)}</strong> <span class="text-muted text-sm">${this.escapeHtml(d.assignment.driver.phone)}</span>` :
        `<span class="text-muted">—</span>`;

      let actionButtons = '';
      if (isPending) {
        actionButtons = `
          <button class="btn btn-action-assign" onclick="app.openAssignModal('${d.id}')">Assign</button>
          <button class="btn btn-action-edit" onclick="app.openEditDeliveryModal('${d.id}')">Edit</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-action-delete" onclick="app.deleteDelivery('${d.id}')">Delete</button>
        `;
      } else if (isAssigned) {
        actionButtons = `
          <button class="btn btn-action-transit" onclick="app.transitionStatus('${d.id}', 'in_transit')">Dispatch</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else if (isInTransit) {
        actionButtons = `
          <button class="btn btn-action-deliver" onclick="app.transitionStatus('${d.id}', 'delivered')">Deliver</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else {
        actionButtons = `
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
          <button class="btn btn-action-delete" onclick="app.deleteDelivery('${d.id}')">Delete</button>
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

  renderBoard() {
    const cols = {
      pending: document.getElementById('boardColPending'),
      assigned: document.getElementById('boardColAssigned'),
      in_transit: document.getElementById('boardColInTransit'),
      delivered: document.getElementById('boardColDelivered'),
      cancelled: document.getElementById('boardColCancelled')
    };

    Object.values(cols).forEach(c => c.innerHTML = '');

    const counts = { pending: 0, assigned: 0, in_transit: 0, delivered: 0, cancelled: 0 };
    const filtered = this.getFilteredDeliveries();

    filtered.forEach(d => {
      if (counts[d.status] !== undefined) counts[d.status]++;
      const colEl = cols[d.status];
      if (!colEl) return;

      const card = document.createElement('div');
      card.className = 'board-card';

      let cardActions = '';
      if (d.status === 'pending') {
        cardActions = `
          <button class="btn btn-action-assign" onclick="app.openAssignModal('${d.id}')">Assign Resource</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
        `;
      } else if (d.status === 'assigned') {
        cardActions = `
          <button class="btn btn-action-transit" onclick="app.transitionStatus('${d.id}', 'in_transit')">Dispatch</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else if (d.status === 'in_transit') {
        cardActions = `
          <button class="btn btn-action-deliver" onclick="app.transitionStatus('${d.id}', 'delivered')">Mark Delivered</button>
          <button class="btn btn-action-cancel" onclick="app.transitionStatus('${d.id}', 'cancelled')">Cancel</button>
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit</button>
        `;
      } else {
        cardActions = `
          <button class="btn btn-ghost btn-sm" onclick="app.viewDeliveryDetails('${d.id}')">Audit Log</button>
        `;
      }

      card.innerHTML = `
        <div class="board-card-header">
          <span class="id-code">${d.id}</span>
          <span class="priority-${d.priority}">${d.priority.toUpperCase()}</span>
        </div>
        <div class="board-card-route">
          <div class="board-card-route-pickup">${this.escapeHtml(d.pickup_address)}</div>
          <div class="board-card-route-dropoff">➔ ${this.escapeHtml(d.dropoff_address)}</div>
        </div>
        ${d.assignment ? `
          <div class="board-card-meta">
            <div>🚚 ${this.escapeHtml(d.assignment.vehicle.registration_number)}</div>
            <div>👤 ${this.escapeHtml(d.assignment.driver.name)}</div>
          </div>
        ` : ''}
        <div class="board-card-actions">${cardActions}</div>
      `;
      colEl.appendChild(card);
    });

    document.getElementById('boardCountPending').textContent = counts.pending;
    document.getElementById('boardCountAssigned').textContent = counts.assigned;
    document.getElementById('boardCountInTransit').textContent = counts.in_transit;
    document.getElementById('boardCountDelivered').textContent = counts.delivered;
    document.getElementById('boardCountCancelled').textContent = counts.cancelled;
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
        `<span class="badge badge-in_transit">Delivery ${this.escapeHtml(v.active_delivery.delivery_id)}</span>
         <div class="text-sm text-muted">${this.escapeHtml(v.active_delivery.pickup_address)} ➔ ${this.escapeHtml(v.active_delivery.dropoff_address)}</div>` :
        `<span class="text-muted">None</span>`;

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
        <td class="text-right">
          <div class="table-actions">
            <button class="btn btn-action-edit" onclick="app.openEditVehicleModal('${v.id}')">Edit</button>
            <button class="btn btn-action-delete" onclick="app.deleteVehicle('${v.id}')">Delete</button>
          </div>
        </td>
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
        `<span class="badge badge-in_transit">Delivery ${this.escapeHtml(d.active_delivery.delivery_id)}</span>
         <div class="text-sm text-muted">${this.escapeHtml(d.active_delivery.pickup_address)} ➔ ${this.escapeHtml(d.active_delivery.dropoff_address)}</div>` :
        `<span class="text-muted">None</span>`;

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
        <td class="text-right">
          <div class="table-actions">
            <button class="btn btn-action-edit" onclick="app.openEditDriverModal('${d.id}')">Edit</button>
            <button class="btn btn-action-delete" onclick="app.deleteDriver('${d.id}')">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  openAssignModal(deliveryId) {
    const delivery = state.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return;

    document.getElementById('assignDeliveryId').value = deliveryId;
    document.getElementById('assignConflictNotice').style.display = 'none';
    const sugBox = document.getElementById('assignSuggestionBox');
    if (sugBox) sugBox.style.display = 'none';

    document.getElementById('assignDeliveryPreview').innerHTML = `
      <div style="font-weight: 700; margin-bottom: 0.25rem;">Delivery: <span class="id-code">${delivery.id}</span> [${delivery.priority.toUpperCase()}]</div>
      <div class="preview-route">
        <div><strong>Pickup:</strong> ${this.escapeHtml(delivery.pickup_address)}</div>
        <div><strong>Dropoff:</strong> ${this.escapeHtml(delivery.dropoff_address)}</div>
        <div><strong>Scheduled:</strong> ${new Date(delivery.scheduled_time).toLocaleString()}</div>
      </div>
    `;

    // Eligible available vehicles
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

    // Eligible available drivers
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
      if (!res.ok) throw new Error(body.message || 'Assignment failed');

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
      if (!res.ok) throw new Error(body.message || 'Status transition failed');

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
                    <td><strong>${this.escapeHtml(h.vehicle_registration_number)}</strong> (${this.escapeHtml(h.vehicle_type)})</td>
                    <td><strong>${this.escapeHtml(h.driver_name)}</strong> (${this.escapeHtml(h.driver_phone)})</td>
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
      historyHtml = `<p class="text-danger">Failed to load assignment logs: ${this.escapeHtml(err.message)}</p>`;
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
            <div><strong>Vehicle:</strong> ${this.escapeHtml(delivery.assignment.vehicle.registration_number)} (${this.escapeHtml(delivery.assignment.vehicle.type)})</div>
            <div><strong>Driver:</strong> ${this.escapeHtml(delivery.assignment.driver.name)} (${this.escapeHtml(delivery.assignment.driver.phone)})</div>
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

  openNewDeliveryModal() {
    document.getElementById('deliveryEditId').value = '';
    document.getElementById('modalNewDeliveryTitle').textContent = 'Create Delivery Request';
    document.getElementById('btnSubmitDelivery').textContent = 'Submit Delivery';
    document.getElementById('formNewDelivery').reset();
    document.getElementById('deliveryRequiredCapacity').value = '';
    document.getElementById('deliveryRequiredType').value = '';
    this.setDefaultScheduledTime();
    this.openModal('modalNewDelivery');
  },

  openEditDeliveryModal(deliveryId) {
    const d = state.deliveries.find(item => item.id === deliveryId);
    if (!d) return;
    document.getElementById('deliveryEditId').value = d.id;
    document.getElementById('modalNewDeliveryTitle').textContent = `Edit Delivery ${d.id}`;
    document.getElementById('btnSubmitDelivery').textContent = 'Update Delivery';
    document.getElementById('deliveryPickup').value = d.pickup_address;
    document.getElementById('deliveryDropoff').value = d.dropoff_address;
    document.getElementById('deliveryScheduledTime').value = new Date(d.scheduled_time).toISOString().slice(0, 16);
    document.getElementById('deliveryPriority').value = d.priority;
    document.getElementById('deliveryRequiredCapacity').value = d.required_capacity || '';
    document.getElementById('deliveryRequiredType').value = d.required_vehicle_type || '';
    document.getElementById('deliveryNotes').value = d.notes || '';
    this.openModal('modalNewDelivery');
  },

  async handleDeliveryFormSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('deliveryEditId').value;
    const reqCapVal = document.getElementById('deliveryRequiredCapacity').value;
    const reqTypeVal = document.getElementById('deliveryRequiredType').value;

    const payload = {
      pickup_address: document.getElementById('deliveryPickup').value.trim(),
      dropoff_address: document.getElementById('deliveryDropoff').value.trim(),
      scheduled_time: new Date(document.getElementById('deliveryScheduledTime').value).toISOString(),
      priority: document.getElementById('deliveryPriority').value,
      required_capacity: reqCapVal ? Number(reqCapVal) : 0,
      required_vehicle_type: reqTypeVal ? reqTypeVal.trim() : null,
      notes: document.getElementById('deliveryNotes').value.trim()
    };

    const url = editId ? `/deliveries/${editId}` : '/deliveries';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await this.apiFetch(url, {
        method,
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Operation failed');

      this.showToast(editId ? `Delivery ${editId} updated!` : `Delivery ${body.id} created!`, 'success');
      this.closeModal('modalNewDelivery');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async deleteDelivery(id) {
    if (!confirm(`Are you sure you want to delete delivery '${id}'? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/deliveries/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to delete delivery');

      this.showToast(`Delivery '${id}' deleted`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openNewVehicleModal() {
    document.getElementById('vehicleEditId').value = '';
    document.getElementById('modalNewVehicleTitle').textContent = 'Register Vehicle';
    document.getElementById('btnSubmitVehicle').textContent = 'Save Vehicle';
    document.getElementById('formNewVehicle').reset();
    this.openModal('modalNewVehicle');
  },

  openEditVehicleModal(vehicleId) {
    const v = state.vehicles.find(item => item.id === vehicleId);
    if (!v) return;
    document.getElementById('vehicleEditId').value = v.id;
    document.getElementById('modalNewVehicleTitle').textContent = `Edit Vehicle ${v.registration_number}`;
    document.getElementById('btnSubmitVehicle').textContent = 'Update Vehicle';
    document.getElementById('vehicleReg').value = v.registration_number;
    document.getElementById('vehicleType').value = v.type;
    document.getElementById('vehicleCapacity').value = v.capacity;
    document.getElementById('vehicleInitialStatus').value = v.status;
    this.openModal('modalNewVehicle');
  },

  async handleVehicleFormSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('vehicleEditId').value;
    const payload = {
      registration_number: document.getElementById('vehicleReg').value.trim(),
      type: document.getElementById('vehicleType').value.trim(),
      capacity: parseFloat(document.getElementById('vehicleCapacity').value),
      status: document.getElementById('vehicleInitialStatus').value
    };

    const url = editId ? `/vehicles/${editId}` : '/vehicles';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Operation failed');

      this.showToast(editId ? `Vehicle updated!` : `Vehicle ${body.registration_number} registered!`, 'success');
      this.closeModal('modalNewVehicle');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async deleteVehicle(id) {
    if (!confirm(`Are you sure you want to delete vehicle '${id}'? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/vehicles/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to delete vehicle');

      this.showToast(`Vehicle '${id}' deleted`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  openNewDriverModal() {
    document.getElementById('driverEditId').value = '';
    document.getElementById('modalNewDriverTitle').textContent = 'Register Driver';
    document.getElementById('btnSubmitDriver').textContent = 'Save Driver';
    document.getElementById('formNewDriver').reset();
    this.openModal('modalNewDriver');
  },

  openEditDriverModal(driverId) {
    const d = state.drivers.find(item => item.id === driverId);
    if (!d) return;
    document.getElementById('driverEditId').value = d.id;
    document.getElementById('modalNewDriverTitle').textContent = `Edit Driver ${d.name}`;
    document.getElementById('btnSubmitDriver').textContent = 'Update Driver';
    document.getElementById('driverName').value = d.name;
    document.getElementById('driverPhone').value = d.phone;
    document.getElementById('driverInitialStatus').value = d.availability_status;
    this.openModal('modalNewDriver');
  },

  async handleDriverFormSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('driverEditId').value;
    const payload = {
      name: document.getElementById('driverName').value.trim(),
      phone: document.getElementById('driverPhone').value.trim(),
      availability_status: document.getElementById('driverInitialStatus').value
    };

    const url = editId ? `/drivers/${editId}` : '/drivers';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Operation failed');

      this.showToast(editId ? `Driver updated!` : `Driver ${body.name} registered!`, 'success');
      this.closeModal('modalNewDriver');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async deleteDriver(id) {
    if (!confirm(`Are you sure you want to delete driver '${id}'? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/drivers/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to delete driver');

      this.showToast(`Driver '${id}' deleted`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleVehicleStatusChange(vehicleId, newStatus) {
    try {
      const res = await fetch(`/vehicles/${vehicleId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to update vehicle status');

      this.showToast(`Vehicle status changed to ${newStatus}`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
      await this.refreshAll();
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
      if (!res.ok) throw new Error(body.message || 'Failed to update driver status');

      this.showToast(`Driver status changed to ${newStatus}`, 'success');
      await this.refreshAll();
    } catch (err) {
      this.showToast(err.message, 'error');
      await this.refreshAll();
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

  async suggestPairing() {
    const deliveryId = document.getElementById('assignDeliveryId').value;
    if (!deliveryId) return;

    const box = document.getElementById('assignSuggestionBox');
    box.style.display = 'block';
    box.className = 'alert alert-info';
    box.innerHTML = '<span class="text-muted">Analyzing fleet capacity fit and balancing driver workloads...</span>';

    try {
      const res = await this.apiFetch(`/deliveries/${deliveryId}/suggestions`);
      if (!res.ok) throw new Error('Failed to retrieve resource suggestions');
      const data = await res.json();

      if (data.recommended_pairing) {
        const p = data.recommended_pairing;
        document.getElementById('assignVehicleSelect').value = p.vehicle_id;
        document.getElementById('assignDriverSelect').value = p.driver_id;

        box.className = 'alert alert-info';
        box.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 0.25rem;">✨ Optimal Match Identified:</div>
          <div><strong>Vehicle:</strong> ${this.escapeHtml(p.vehicle_registration)} &nbsp;|&nbsp; <strong>Driver:</strong> ${this.escapeHtml(p.driver_name)}</div>
          <div class="text-xs mt-1" style="color: #1e40af;"><strong>Rationale:</strong> ${this.escapeHtml(p.rationale)}</div>
        `;
      } else {
        box.className = 'alert alert-warning';
        box.innerHTML = `
          <div>⚠️ <strong>No fully compatible pairing available.</strong></div>
          <div class="text-xs mt-1">No currently available vehicle meets the cargo payload requirement (${data.delivery_requirements.required_capacity} kg) or vehicle type filter.</div>
        `;
      }
    } catch (err) {
      box.className = 'alert alert-danger';
      box.textContent = err.message;
    }
  },

  async loadPriorityQueue() {
    try {
      const res = await this.apiFetch('/deliveries/queue');
      if (!res.ok) throw new Error('Failed to load priority queue');
      const data = await res.json();
      state.queue = data.queue || [];
      const badge = document.getElementById('countTabQueue');
      if (badge) badge.textContent = state.queue.length;

      const tbody = document.getElementById('queueTableBody');
      const emptyState = document.getElementById('queueEmptyState');
      tbody.innerHTML = '';

      if (state.queue.length === 0) {
        emptyState.style.display = 'block';
        return;
      }
      emptyState.style.display = 'none';

      state.queue.forEach((d, idx) => {
        const tr = document.createElement('tr');
        const reqCap = d.required_capacity ? `${d.required_capacity} kg` : 'Standard';
        const reqType = d.required_vehicle_type ? d.required_vehicle_type : 'Any';

        tr.innerHTML = `
          <td><strong>#${idx + 1}</strong></td>
          <td><span class="id-code">${d.id}</span></td>
          <td><span class="badge badge-priority-${d.priority}">${d.priority.toUpperCase()}</span></td>
          <td>
            <div class="route-schematic">
              <span>${this.escapeHtml(d.pickup_address)}</span>
              <span class="route-arrow">➔</span>
              <span>${this.escapeHtml(d.dropoff_address)}</span>
            </div>
          </td>
          <td><span class="text-sm">${new Date(d.scheduled_time).toLocaleString()}</span></td>
          <td><span class="text-sm">${reqCap} | ${this.escapeHtml(reqType)}</span></td>
          <td class="text-right">
            <button class="btn btn-primary btn-sm" onclick="app.openAssignModal('${d.id}')">⚡ Assign</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadPerformanceAnalytics() {
    try {
      const res = await this.apiFetch('/api/analytics/performance');
      if (!res.ok) throw new Error('Failed to load performance analytics');
      const data = await res.json();
      state.analytics = data;

      // Fleet card
      const fltRate = data.fleet_utilization.utilization_rate_pct;
      document.getElementById('anlFleetRate').textContent = `${fltRate}%`;
      document.getElementById('anlFleetProgress').style.width = `${fltRate}%`;
      document.getElementById('anlFleetSub').textContent = 
        `${data.fleet_utilization.assigned_vehicles} of ${data.fleet_utilization.total_vehicles} vehicles deployed`;

      // Driver card
      const drvRate = data.driver_utilization.utilization_rate_pct;
      document.getElementById('anlDriverRate').textContent = `${drvRate}%`;
      document.getElementById('anlDriverProgress').style.width = `${drvRate}%`;
      document.getElementById('anlDriverSub').textContent = 
        `${data.driver_utilization.assigned_drivers} of ${data.driver_utilization.total_drivers} drivers dispatched`;

      // Completion card
      const compRate = data.delivery_performance.completion_rate_pct;
      document.getElementById('anlCompletionRate').textContent = `${compRate}%`;
      document.getElementById('anlCompletionProgress').style.width = `${compRate}%`;
      document.getElementById('anlCompletionSub').textContent = 
        `${data.delivery_performance.completed_deliveries} delivered, ${data.delivery_performance.cancelled_deliveries} cancelled`;

      // Vehicle categories table
      const vehBody = document.getElementById('anlVehiclesBody');
      vehBody.innerHTML = '';
      data.vehicle_types.forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${this.escapeHtml(v.type)}</strong></td>
          <td>${v.total}</td>
          <td><span class="text-primary" style="font-weight:700;">${v.active}</span></td>
          <td><span class="text-success">${v.available}</span></td>
          <td><span class="badge ${v.utilization_pct > 0 ? 'badge-in_transit' : 'badge-available'}">${v.utilization_pct}%</span></td>
        `;
        vehBody.appendChild(tr);
      });

      // Drivers leaderboard table
      const drvBody = document.getElementById('anlDriversBody');
      drvBody.innerHTML = '';
      data.driver_workload.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${this.escapeHtml(d.name)}</strong></td>
          <td><span class="badge badge-${d.availability_status}">${d.availability_status}</span></td>
          <td>${d.active_trips}</td>
          <td><strong class="text-success">${d.completed_trips}</strong></td>
        `;
        drvBody.appendChild(tr);
      });
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async loadAuditLogs() {
    try {
      const entity = document.getElementById('filterAuditEntity')?.value || '';
      const url = entity ? `/api/audit-logs?entity_type=${encodeURIComponent(entity)}` : '/api/audit-logs';
      const res = await this.apiFetch(url);
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      state.auditLogs = data.logs || [];

      const tbody = document.getElementById('auditTableBody');
      tbody.innerHTML = '';
      if (state.auditLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 2rem;">No audit records found.</td></tr>';
        return;
      }

      state.auditLogs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="text-sm font-mono">${new Date(l.timestamp).toLocaleString()}</span></td>
          <td><span class="badge badge-system">${l.entity_type.toUpperCase()}</span></td>
          <td><span class="id-code">${l.entity_id}</span></td>
          <td><span class="badge badge-available">${l.action}</span></td>
          <td><span class="text-sm" style="font-weight:700;">${this.escapeHtml(l.performed_by)}</span></td>
          <td><span class="text-sm">${this.escapeHtml(l.details || '-')}</span></td>
        `;
        tbody.appendChild(tr);
      });
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
