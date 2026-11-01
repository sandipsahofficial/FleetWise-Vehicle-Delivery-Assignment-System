const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 6 - Advanced Enhancements & Operational Governance', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('1. Capacity & Vehicle Type Matching: strict validation against delivery requirements', async () => {
    // Register vehicles with varying capacities and types
    const resV1 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'VAN-100', type: 'Small Van', capacity: 500 })
    });
    assert.equal(resV1.status, 201);
    const vSmall = await resV1.json();

    const resV2 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'FLAT-200', type: 'Flatbed Truck', capacity: 3000 })
    });
    assert.equal(resV2.status, 201);
    const vFlatbed = await resV2.json();

    const resV3 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'REEF-300', type: 'Refrigerated Truck', capacity: 2500 })
    });
    assert.equal(resV3.status, 201);
    const vReefer = await resV3.json();

    // Register driver
    const resD = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex Specialist', phone: '+1-555-888-001' })
    });
    assert.equal(resD.status, 201);
    const driver = await resD.json();

    // Create delivery requiring 1800kg and refrigerated vehicle type
    const resDel = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Port Cold Storage',
        dropoff_address: 'City Hospital',
        scheduled_time: '2026-11-01T10:00:00Z',
        priority: 'urgent',
        required_capacity: 1800,
        required_vehicle_type: 'Refrigerated'
      })
    });
    assert.equal(resDel.status, 201);
    const del = await resDel.json();
    assert.equal(del.required_capacity, 1800);
    assert.equal(del.required_vehicle_type, 'Refrigerated');

    // Attempt 1: Small Van has insufficient capacity (500 < 1800) -> 409 Conflict
    const resFailCap = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vSmall.id, driver_id: driver.id })
    });
    assert.equal(resFailCap.status, 409);
    const errCap = await resFailCap.json();
    assert.match(errCap.message, /capacity .* is insufficient/i);

    // Attempt 2: Flatbed has sufficient capacity (3000 >= 1800) but wrong vehicle type -> 409 Conflict
    const resFailType = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vFlatbed.id, driver_id: driver.id })
    });
    assert.equal(resFailType.status, 409);
    const errType = await resFailType.json();
    assert.match(errType.message, /does not match required delivery vehicle type/i);

    // Attempt 3: Reefer Truck matches both capacity (2500 >= 1800) and type -> 200 OK
    const resSuccess = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vReefer.id, driver_id: driver.id })
    });
    assert.equal(resSuccess.status, 200);
    const successData = await resSuccess.json();
    assert.equal(successData.delivery.status, 'assigned');
    assert.equal(successData.delivery.assignment.vehicle.id, vReefer.id);
  });

  await t.test('2. Priority-Based Delivery Queue: orders pending deliveries by priority and schedule', async () => {
    // Create deliveries with mixed priorities
    await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Warehouse A',
        dropoff_address: 'Store A',
        scheduled_time: '2026-11-01T12:00:00Z',
        priority: 'low'
      })
    });

    await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Warehouse B',
        dropoff_address: 'Store B',
        scheduled_time: '2026-11-01T14:00:00Z',
        priority: 'urgent'
      })
    });

    await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Warehouse C',
        dropoff_address: 'Store C',
        scheduled_time: '2026-11-01T08:00:00Z',
        priority: 'medium'
      })
    });

    await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Warehouse D',
        dropoff_address: 'Store D',
        scheduled_time: '2026-11-01T09:00:00Z',
        priority: 'high'
      })
    });

    const resQueue = await fetch(`${baseUrl}/deliveries/queue`);
    assert.equal(resQueue.status, 200);
    const queueData = await resQueue.json();
    assert.ok(queueData.count >= 4);

    const priorities = queueData.queue.map(d => d.priority);
    // Urgent first, then high, medium, low
    assert.deepEqual(priorities, ['urgent', 'high', 'medium', 'low']);
  });

  await t.test('3. Suggestion Engine: recommends eligible resources and pairs with best fit', async () => {
    const v1 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'VAN-S1', type: 'Van', capacity: 800 })
    })).json();

    const _v2 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'TRK-S2', type: 'Truck', capacity: 2500 })
    })).json();

    const _d1 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dan Rookie', phone: '+1-555-111-222' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Supplier',
        dropoff_address: 'Customer',
        scheduled_time: '2026-11-02T10:00:00Z',
        required_capacity: 700,
        priority: 'high'
      })
    })).json();

    const resSuggest = await fetch(`${baseUrl}/deliveries/${del.id}/suggestions`);
    assert.equal(resSuggest.status, 200);
    const suggestData = await resSuggest.json();
    assert.ok(suggestData.recommended_pairing);
    // Van-S1 has capacity 800 (delta 100) vs Truck 2500 (delta 1800) -> Van-S1 is best fit
    assert.equal(suggestData.recommended_pairing.vehicle_id, v1.id);
    assert.ok(suggestData.recommended_pairing.rationale.includes('Optimal capacity fit'));

    // Verify authoritative assignment succeeds with suggested resources
    const resAssign = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: suggestData.recommended_pairing.vehicle_id,
        driver_id: suggestData.recommended_pairing.driver_id
      })
    });
    assert.equal(resAssign.status, 200);
    const assignData = await resAssign.json();
    assert.equal(assignData.delivery.status, 'assigned');
  });

  await t.test('4. Audit Trail: logs assignment and lifecycle transitions', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'AUDIT-V1', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Audited Driver', phone: '+1-555-999-111' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Start',
        dropoff_address: 'End',
        scheduled_time: '2026-11-03T11:00:00Z'
      })
    })).json();

    await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    const resAudit = await fetch(`${baseUrl}/api/audit-logs`);
    assert.equal(resAudit.status, 200);
    const auditData = await resAudit.json();
    assert.ok(auditData.count >= 4);

    const actions = auditData.logs.map(l => l.action);
    assert.ok(actions.includes('assigned'));
    assert.ok(actions.includes('status_changed'));
  });

  await t.test('5. Fleet Utilization & Delivery Performance Analytics', async () => {
    const v1 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'PERF-1', type: 'Van', capacity: 1000 })
    })).json();

    const v2 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'PERF-2', type: 'Truck', capacity: 2000 })
    })).json();

    const d1 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Perf Driver 1', phone: '+1-555-777-111' })
    })).json();

    const d2 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Perf Driver 2', phone: '+1-555-777-222' })
    })).json();

    // Create and deliver 1 delivery
    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Hub A',
        dropoff_address: 'Hub B',
        scheduled_time: '2026-11-01T10:00:00Z'
      })
    })).json();
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v1.id, driver_id: d1.id })
    });
    await fetch(`${baseUrl}/deliveries/${del1.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    await fetch(`${baseUrl}/deliveries/${del1.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });

    // Create and assign 1 active delivery
    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Hub C',
        dropoff_address: 'Hub D',
        scheduled_time: '2026-11-01T12:00:00Z'
      })
    })).json();
    await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v2.id, driver_id: d2.id })
    });

    const resPerf = await fetch(`${baseUrl}/api/analytics/performance`);
    assert.equal(resPerf.status, 200);
    const data = await resPerf.json();

    assert.ok(data.fleet_utilization.total_vehicles >= 2);
    assert.ok(data.delivery_performance.total_deliveries >= 2);
    assert.ok(data.delivery_performance.completed_deliveries >= 1);
    assert.ok(data.delivery_performance.completion_rate_pct > 0);
  });

  await t.test('6. Role-Based Access Control (RBAC): enforces dispatcher vs fleet_manager boundaries', async () => {
    // 1. Dispatcher tries to create vehicle -> 403 Forbidden
    const resForbiddenCreate = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'dispatcher'
      },
      body: JSON.stringify({ registration_number: 'HACK-01', type: 'Van', capacity: 1000 })
    });
    assert.equal(resForbiddenCreate.status, 403);
    const errCreate = await resForbiddenCreate.json();
    assert.match(errCreate.message, /Access denied.*dispatcher/);

    // 2. Fleet Manager creates vehicle -> 201 Created
    const resAllowedCreate = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'fleet_manager'
      },
      body: JSON.stringify({ registration_number: 'FM-01', type: 'Van', capacity: 1000 })
    });
    assert.equal(resAllowedCreate.status, 201);
    const createdVeh = await resAllowedCreate.json();

    // 3. Dispatcher cannot set vehicle to maintenance -> 403 Forbidden
    const resForbiddenPatch = await fetch(`${baseUrl}/vehicles/${createdVeh.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'dispatcher'
      },
      body: JSON.stringify({ status: 'maintenance' })
    });
    assert.equal(resForbiddenPatch.status, 403);

    // 4. Fleet Manager can set vehicle to maintenance -> 200 OK
    const resAllowedPatch = await fetch(`${baseUrl}/vehicles/${createdVeh.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'fleet_manager'
      },
      body: JSON.stringify({ status: 'maintenance' })
    });
    assert.equal(resAllowedPatch.status, 200);
    const patchedVeh = await resAllowedPatch.json();
    assert.equal(patchedVeh.status, 'maintenance');

    // 5. Dispatcher is allowed to create and manage deliveries
    const resAllowedDel = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'dispatcher'
      },
      body: JSON.stringify({
        pickup_address: 'Route Start',
        dropoff_address: 'Route End',
        scheduled_time: '2026-11-04T09:00:00Z'
      })
    });
    assert.equal(resAllowedDel.status, 201);
  });
});
