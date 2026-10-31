let mapInstance = null;
let vehicleMarker = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadTracking() {
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    showError('Tracking token is missing');
    return;
  }

  try {
    const res = await fetch(`/api/track/${encodeURIComponent(token)}`);
    if (!res.ok) {
      showError('Tracking link not found or expired');
      return;
    }

    const data = await res.json();
    renderTracking(data);

    // If active in transit, poll for updates every 10s
    if (data.status === 'in_transit') {
      setTimeout(loadTracking, 10000);
    }
  } catch (_) {
    showError('Unable to load shipment tracking information');
  }
}

function renderTracking(data) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('contentState').style.display = 'block';

  // Status badge
  const badge = document.getElementById('trackingStatusBadge');
  badge.className = `badge-status badge-${data.status}`;
  badge.textContent = data.status.replace('_', ' ');

  // Headline
  document.getElementById('trackingStageText').textContent = data.progress_stage;

  // Timeline
  const steps = ['pending', 'assigned', 'in_transit', 'delivered'];
  const statusIdx = steps.indexOf(data.status);

  steps.forEach((s, idx) => {
    const el = document.getElementById(`step_${s}`);
    if (!el) return;
    el.classList.remove('completed', 'active');
    if (data.status === 'cancelled') {
      // Cancelled state
    } else if (idx < statusIdx) {
      el.classList.add('completed');
    } else if (idx === statusIdx) {
      el.classList.add('active');
    }
  });

  // Coarse Destination Area
  const areaWrapper = document.getElementById('destinationAreaWrapper');
  const areaEl = document.getElementById('destinationArea');
  if (data.destination_area && areaWrapper && areaEl) {
    areaWrapper.style.display = 'block';
    areaEl.textContent = data.destination_area;
  } else if (areaWrapper) {
    areaWrapper.style.display = 'none';
  }

  // Scheduled / Delivered info
  if (data.status === 'delivered' && data.delivered_at) {
    document.getElementById('deliveryMeta').textContent = `Delivered on ${new Date(data.delivered_at).toLocaleString()}`;
  } else if (data.scheduled_time) {
    document.getElementById('deliveryMeta').textContent = `Estimated schedule: ${new Date(data.scheduled_time).toLocaleString()}`;
  }

  // Live Map
  const mapContainer = document.getElementById('mapWrapper');
  if (data.status === 'in_transit' && data.vehicle_location && typeof L !== 'undefined') {
    mapContainer.style.display = 'block';
    const lat = Number(data.vehicle_location.lat);
    const lng = Number(data.vehicle_location.lng);

    if (!mapInstance) {
      mapInstance = L.map('mapWrapper').setView([lat, lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapInstance);

      const icon = L.divIcon({
        className: 'custom-fleet-icon',
        html: '<div style="font-size: 24px; text-align: center;">🚚</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      vehicleMarker = L.marker([lat, lng], { icon }).addTo(mapInstance);
      vehicleMarker.bindPopup('Delivery Vehicle en route').openPopup();
    } else {
      vehicleMarker.setLatLng([lat, lng]);
      mapInstance.setView([lat, lng]);
    }
  } else {
    mapContainer.style.display = 'none';
  }
}

function showError(msg) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('contentState').style.display = 'none';
  const errEl = document.getElementById('errorState');
  errEl.style.display = 'block';
  document.getElementById('errorMessage').textContent = msg;
}

document.addEventListener('DOMContentLoaded', loadTracking);
