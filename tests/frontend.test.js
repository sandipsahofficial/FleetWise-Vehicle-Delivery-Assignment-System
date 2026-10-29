const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 5 - Frontend Static Serving & Demo Seeding', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('GET / serves index.html with FleetWise branding', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('FleetWise'));
    assert.ok(html.includes('Vehicle &amp; Delivery Assignment System') || html.includes('Vehicle & Delivery Assignment System'));
    assert.ok(html.includes('id="deliveriesTable"'));
  });

  await t.test('GET /style.css serves responsive stylesheet', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    assert.equal(res.status, 200);
    const css = await res.text();
    assert.ok(css.includes('--primary:'));
    assert.ok(css.includes('.kpi-card'));
  });

  await t.test('GET /app.js serves frontend controller', async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    assert.equal(res.status, 200);
    const js = await res.text();
    assert.ok(js.includes('FleetWise - Frontend Client Application'));
  });

  await t.test('POST /api/seed seeds data and dashboard reflects it', async () => {
    const seedRes = await fetch(`${baseUrl}/api/seed`, { method: 'POST' });
    assert.equal(seedRes.status, 200);
    const seedBody = await seedRes.json();
    assert.equal(seedBody.seeded, true);

    // Verify stats
    const statsRes = await fetch(`${baseUrl}/api/dashboard/stats`);
    const stats = await statsRes.json();
    assert.ok(stats.vehicles.total >= 5);
    assert.ok(stats.drivers.total >= 5);
    assert.ok(stats.deliveries.total >= 5);
    assert.ok(stats.deliveries.active >= 2);
  });
});

