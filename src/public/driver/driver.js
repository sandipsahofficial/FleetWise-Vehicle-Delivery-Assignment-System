const driverApp = {
  accessToken: null,
  currentUser: null,
  activeTrip: null,
  deliveries: [],
  gpsWatchId: null,
  isSharingGps: false,
  lastCoords: null,

  async init() {
    // Register service worker for offline static shell caching
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/driver/sw.js');
      } catch (_) {}
    }

    const hasRefresh = Boolean(localStorage.getItem('fleetwise_refresh_token'));
    if (hasRefresh) {
      const ok = await this.silentRefresh();
      if (ok && this.currentUser?.role === 'driver') {
        this.showMainView();
        await this.loadDeliveries();
      } else {
        this.showLoginView();
      }
    } else {
      this.showLoginView();
    }
  },

  showLoginView() {
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('mainDriverView').style.display = 'none';
  },

  showMainView() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('mainDriverView').style.display = 'block';
    document.getElementById('driverNameLabel').textContent = this.currentUser?.username || 'Driver';
  },

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('driverUsername').value.trim();
    const password = document.getElementById('driverPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');

      if (data.user.role !== 'driver') {
        throw new Error('Access denied: This portal is for drivers only.');
      }

      this.accessToken = data.accessToken;
      this.currentUser = data.user;
      localStorage.setItem('fleetwise_refresh_token', data.refreshToken);

      this.showMainView();
      await this.loadDeliveries();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
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
        return false;
      }

      const data = await res.json();
      this.accessToken = data.accessToken;
      this.currentUser = data.user;
      localStorage.setItem('fleetwise_refresh_token', data.refreshToken);
      return true;
    } catch (_) {
      return false;
    }
  },

  async apiFetch(url, options = {}) {
    const headers = { ...options.headers };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let res = await fetch(url, { ...options, headers });
    if (res.status === 401 && localStorage.getItem('fleetwise_refresh_token')) {
      const refreshed = await this.silentRefresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        res = await fetch(url, { ...options, headers });
      } else {
        this.showLoginView();
      }
    }
    return res;
  },

  async logout() {
    this.stopGps();
    const refreshToken = localStorage.getItem('fleetwise_refresh_token');
    if (refreshToken) {
      try {
        await fetch('/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
      } catch (_) {}
    }
    localStorage.removeItem('fleetwise_refresh_token');
    this.accessToken = null;
    this.currentUser = null;
    this.showLoginView();
  },

  async loadDeliveries() {
    try {
      const res = await this.apiFetch('/deliveries');
      if (!res.ok) throw new Error('Failed to load assigned deliveries');

      const data = await res.json();
      this.deliveries = Array.isArray(data) ? data : (data.data || []);
      this.renderDeliveries();
    } catch (err) {
      document.getElementById('deliveriesList').innerHTML = `<p style="color:#dc2626; font-size:13px;">${err.message}</p>`;
    }
  },

  renderDeliveries() {
    // Look for an in-transit trip first, then assigned
    const inTransit = this.deliveries.find((d) => d.status === 'in_transit');
    const assigned = this.deliveries.find((d) => d.status === 'assigned');
    this.activeTrip = inTransit || assigned || null;

    const activeCard = document.getElementById('activeTripCard');
    const actionGroup = document.getElementById('tripActionGroup');

    if (this.activeTrip) {
      activeCard.style.display = 'block';
      document.getElementById('activeTripTitle').textContent = `Delivery #${this.activeTrip.id}`;
      const badge = document.getElementById('activeTripBadge');
      badge.className = `badge badge-${this.activeTrip.status}`;
      badge.textContent = this.activeTrip.status.replace('_', ' ');

      document.getElementById('tripPickup').textContent = this.activeTrip.pickup_address;
      document.getElementById('tripDropoff').textContent = this.activeTrip.dropoff_address;

      if (this.activeTrip.status === 'assigned') {
        actionGroup.innerHTML = `
          <button class="btn btn-primary" onclick="driverApp.startTrip('${this.activeTrip.id}')">
            🚀 Start Trip
          </button>
        `;
      } else if (this.activeTrip.status === 'in_transit') {
        // Automatically start GPS sharing when trip is in transit
        if (!this.isSharingGps) {
          this.startGps();
        }

        actionGroup.innerHTML = `
          <button class="btn btn-success" onclick="driverApp.openModal('modalOtp')">
            🔑 Complete with Customer OTP
          </button>
          <button class="btn btn-primary" onclick="driverApp.openModal('modalPhoto')">
            📷 Complete with Photo Proof
          </button>
        `;
      }
    } else {
      activeCard.style.display = 'none';
      if (this.isSharingGps) {
        this.stopGps();
      }
    }

    // Render other deliveries list
    const listEl = document.getElementById('deliveriesList');
    const otherDeliveries = this.deliveries.filter((d) => d.id !== this.activeTrip?.id);

    if (otherDeliveries.length === 0 && !this.activeTrip) {
      listEl.innerHTML = '<p style="font-size:13px; color:#64748b;">No assigned trips currently.</p>';
      return;
    }

    listEl.innerHTML = otherDeliveries.map((d) => `
      <div style="padding:10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>#${d.id}</strong>
          <span class="badge badge-${d.status}">${d.status.replace('_', ' ')}</span>
        </div>
        <div style="color:#475569;">${d.pickup_address} ➔ ${d.dropoff_address}</div>
      </div>
    `).join('');
  },

  async startTrip(deliveryId) {
    try {
      const res = await this.apiFetch(`/deliveries/${deliveryId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_transit' })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to start trip');
      }

      this.startGps();
      await this.loadDeliveries();
    } catch (err) {
      alert(err.message);
    }
  },

  startGps() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser or requires HTTPS.');
      return;
    }

    this.isSharingGps = true;
    this.updateGpsUI(true);

    this.gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0, // convert m/s to km/h
          heading: pos.coords.heading || 0
        };

        this.pushLocationToServer(this.lastCoords);
      },
      (_) => {
        this.updateGpsUI(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  },

  stopGps() {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    this.isSharingGps = false;
    this.updateGpsUI(false);
  },

  toggleGps() {
    if (this.isSharingGps) {
      this.stopGps();
    } else {
      this.startGps();
    }
  },

  updateGpsUI(active) {
    const pill = document.getElementById('gpsStatusPill');
    const text = document.getElementById('gpsStatusText');
    const btn = document.getElementById('btnToggleGps');

    if (active) {
      pill.className = 'gps-status gps-active';
      text.textContent = 'GPS: Sharing Live';
      btn.textContent = 'Stop Sharing';
      btn.className = 'btn btn-secondary btn-sm';
    } else {
      pill.className = 'gps-status';
      text.textContent = 'GPS: Inactive';
      btn.textContent = 'Start Sharing';
      btn.className = 'btn btn-secondary btn-sm';
    }
  },

  async pushLocationToServer(coords) {
    if (!this.currentUser?.driver_id) return;
    try {
      await this.apiFetch(`/drivers/${this.currentUser.driver_id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coords)
      });
    } catch (_) {}
  },

  openModal(id) {
    document.getElementById(id).classList.add('open');
  },

  closeModal(id) {
    document.getElementById(id).classList.remove('open');
  },

  async submitOtpCompletion(e) {
    e.preventDefault();
    if (!this.activeTrip) return;

    const otpInput = document.getElementById('inputOtp').value.trim();
    const errEl = document.getElementById('otpErrorMsg');
    const btn = document.getElementById('btnConfirmOtp');
    errEl.style.display = 'none';
    btn.disabled = true;

    try {
      const res = await this.apiFetch(`/deliveries/${this.activeTrip.id}/complete-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: otpInput,
          lat: this.lastCoords?.lat,
          lng: this.lastCoords?.lng
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'OTP verification failed');

      alert('Delivery completed successfully!');
      this.closeModal('modalOtp');
      this.stopGps();
      await this.loadDeliveries();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  },

  previewPhoto(e) {
    const file = e.target.files[0];
    const preview = document.getElementById('photoPreview');
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  },

  async submitPhotoCompletion(e) {
    e.preventDefault();
    if (!this.activeTrip) return;

    const fileInput = document.getElementById('inputPhotoFile');
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select or capture a photo');
      return;
    }

    const errEl = document.getElementById('photoErrorMsg');
    const btn = document.getElementById('btnConfirmPhoto');
    errEl.style.display = 'none';
    btn.disabled = true;

    try {
      const formData = new FormData();
      formData.append('photo', fileInput.files[0]);
      if (this.lastCoords?.lat) formData.append('lat', this.lastCoords.lat);
      if (this.lastCoords?.lng) formData.append('lng', this.lastCoords.lng);

      const res = await this.apiFetch(`/deliveries/${this.activeTrip.id}/complete-photo`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Photo proof upload failed');

      alert('Delivery completed successfully with photo proof!');
      this.closeModal('modalPhoto');
      this.stopGps();
      await this.loadDeliveries();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  },

  async submitFuelLog(e) {
    e.preventDefault();
    const errEl = document.getElementById('fuelErrorMsg');
    const succEl = document.getElementById('fuelSuccessMsg');
    errEl.style.display = 'none';
    succEl.style.display = 'none';

    // Find active vehicle
    const vehicleId = this.activeTrip?.assignment?.vehicle?.id || this.activeTrip?.vehicle_id;
    if (!vehicleId) {
      errEl.textContent = 'You must have an active trip assignment to record fuel.';
      errEl.style.display = 'block';
      return;
    }

    const odometer = parseFloat(document.getElementById('inputFuelOdometer').value);
    const liters = parseFloat(document.getElementById('inputFuelLiters').value);
    const cost = parseFloat(document.getElementById('inputFuelCost').value);

    try {
      const res = await this.apiFetch('/api/fuel-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          odometer,
          liters,
          cost
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to record fuel log');

      succEl.textContent = `Fuel log saved successfully (${liters}L, ${cost})`;
      succEl.style.display = 'block';
      document.getElementById('formDriverFuel').reset();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  driverApp.init();
});

