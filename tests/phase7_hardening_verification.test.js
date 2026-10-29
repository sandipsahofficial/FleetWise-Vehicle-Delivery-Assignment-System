const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');
const { getDb, resetDbForTesting, closeDb } = require('../src/db/database');

test('Phase 7 — Comprehensive FleetWise Verification & Hardening', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // 1. Valid Assignment
  await t.test('Test 1: Valid assignment atomically creates assignment and updates states', async () => {
    // Setup
    const vRes = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V1', type: 'Van', capacity: 1000 })
    });
    assert.equal(vRes.status, 201);
    const v = await vRes.json();

    const dRes = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Valid Driver', phone: '+1-555-7001' })
    });
    assert.equal(dRes.status, 201);
    const d = await dRes.json();

    const delRes = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Point A',
        dropoff_address: 'Point B',
        scheduled_time: '2026-11-10T10:00:00Z',
        priority: 'high'
      })
    });
    assert.equal(delRes.status, 201);
    const del = await delRes.json();

    // Execute Assignment
    const assignRes = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(assignRes.status, 200);
    const assignBody = await assignRes.json();
    assert.equal(assignBody.delivery.status, 'assigned');
    assert.ok(assignBody.delivery.assignment);
    assert.equal(assignBody.delivery.assignment.vehicle.id, v.id);
    assert.equal(assignBody.delivery.assignment.driver.id, d.id);

    // Verify Vehicle & Driver are marked 'assigned'
    const vCheck = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    const dCheck = await (await fetch(`${baseUrl}/drivers/${d.id}`)).json();
    assert.equal(vCheck.status, 'assigned');
    assert.equal(dCheck.availability_status, 'assigned');
  });

  // 2. Reusing an occupied vehicle
  await t.test('Test 2: Reusing an occupied vehicle is rejected with 409 Conflict', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V2', type: 'Van', capacity: 1000 })
    })).json();

    const d1 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver D1', phone: '+1-555-7002' })
    })).json();

    const d2 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver D2', phone: '+1-555-7003' })
    })).json();

    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin 1', dropoff_address: 'Dest 1', scheduled_time: '2026-11-10T11:00:00Z' })
    })).json();

    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin 2', dropoff_address: 'Dest 2', scheduled_time: '2026-11-10T12:00:00Z' })
    })).json();

    // Assign del1 with v and d1
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d1.id })
    });

    // Attempt to assign del2 with same vehicle v
    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d2.id })
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available for assignment|already assigned to active delivery/i);
  });

  // 3. Reusing an occupied driver
  await t.test('Test 3: Reusing an occupied driver is rejected with 409 Conflict', async () => {
    const v1 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V3A', type: 'Van', capacity: 1000 })
    })).json();

    const v2 = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V3B', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Occupied Driver', phone: '+1-555-7004' })
    })).json();

    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin 1', dropoff_address: 'Dest 1', scheduled_time: '2026-11-10T13:00:00Z' })
    })).json();

    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin 2', dropoff_address: 'Dest 2', scheduled_time: '2026-11-10T14:00:00Z' })
    })).json();

    // Assign del1 with v1 and d
    await fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v1.id, driver_id: d.id })
    });

    // Attempt to assign del2 with same driver d
    const res = await fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v2.id, driver_id: d.id })
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.message, /not available for assignment|already assigned to active delivery/i);
  });

  // 4. Both resources occupied
  await t.test('Test 4: Both resources occupied rejected with 409 Conflict', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V4', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver D4', phone: '+1-555-7005' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin', dropoff_address: 'Dest', scheduled_time: '2026-11-10T15:00:00Z' })
    })).json();

    await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    // New delivery attempts to book both occupied resources
    const delNew = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Origin X', dropoff_address: 'Dest X', scheduled_time: '2026-11-10T16:00:00Z' })
    })).json();

    const res = await fetch(`${baseUrl}/deliveries/${delNew.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res.status, 409);
  });

  // 5. Unavailable drivers and vehicles under maintenance
  await t.test('Test 5: Unavailable driver and maintenance vehicle cannot be assigned', async () => {
    const vMaint = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-VMAINT', type: 'Van', capacity: 1000, status: 'maintenance' })
    })).json();

    const dUnavail = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Off Duty Driver', phone: '+1-555-7006', availability_status: 'unavailable' })
    })).json();

    const vAvail = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-VOK', type: 'Van', capacity: 1000 })
    })).json();

    const dAvail = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Available Driver', phone: '+1-555-7007' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Hub', dropoff_address: 'Store', scheduled_time: '2026-11-10T17:00:00Z' })
    })).json();

    // 5a. Maintenance vehicle
    const resMaint = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vMaint.id, driver_id: dAvail.id })
    });
    assert.equal(resMaint.status, 409);
    assert.match((await resMaint.json()).message, /not available for assignment/i);

    // 5b. Unavailable driver
    const resUnavail = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vAvail.id, driver_id: dUnavail.id })
    });
    assert.equal(resUnavail.status, 409);
    assert.match((await resUnavail.json()).message, /not available for assignment/i);
  });

  // 6. Unknown vehicle, driver, and delivery IDs
  await t.test('Test 6: Unknown IDs return 400 or 404', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V6', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Real Driver', phone: '+1-555-7008' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'A', dropoff_address: 'B', scheduled_time: '2026-11-10T18:00:00Z' })
    })).json();

    // 6a: Unknown delivery
    const resDel = await fetch(`${baseUrl}/deliveries/DEL-UNKNOWN-999/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(resDel.status, 404);

    // 6b: Unknown vehicle
    const resVeh = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: 'VEH-UNKNOWN-999', driver_id: d.id })
    });
    assert.equal(resVeh.status, 404);

    // 6c: Unknown driver
    const resDrv = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: 'DRV-UNKNOWN-999' })
    });
    assert.equal(resDrv.status, 404);

    // 6d: Missing fields in body
    const resMiss = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(resMiss.status, 400);
  });

  // 7. Delivery completion and cancellation
  await t.test('Test 7: Delivery completion and cancellation safely release resources without overwriting non-available flags', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V7', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Completing Driver', phone: '+1-555-7009' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Start', dropoff_address: 'End', scheduled_time: '2026-11-10T19:00:00Z' })
    })).json();

    // Assign -> in_transit -> delivered
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
    const resDelivered = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(resDelivered.status, 200);

    // Verify resources released to 'available'
    const vAfter = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    const dAfter = await (await fetch(`${baseUrl}/drivers/${d.id}`)).json();
    assert.equal(vAfter.status, 'available');
    assert.equal(dAfter.availability_status, 'available');

    // Test cancellation release with pending delivery
    const delCancel = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'A', dropoff_address: 'B', scheduled_time: '2026-11-10T20:00:00Z' })
    })).json();
    const resCancelled = await fetch(`${baseUrl}/deliveries/${delCancel.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(resCancelled.status, 200);
    assert.equal((await resCancelled.json()).delivery.status, 'cancelled');
  });

  // 8. Invalid status transitions
  await t.test('Test 8: Invalid status transitions strictly rejected with 409 Conflict', async () => {
    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'A', dropoff_address: 'B', scheduled_time: '2026-11-10T21:00:00Z' })
    })).json();

    // 8a: pending -> in_transit (must be assigned first)
    const res1 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(res1.status, 409);

    // 8b: pending -> delivered (illegal shortcut)
    const res2 = await fetch(`${baseUrl}/deliveries/${del.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(res2.status, 409);
  });

  // 9. Duplicate assignment submissions
  await t.test('Test 9: Duplicate assignment submissions rejected with 409 Conflict', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-V9', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dup Driver', phone: '+1-555-7010' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'A', dropoff_address: 'B', scheduled_time: '2026-11-10T22:00:00Z' })
    })).json();

    // 1st assignment
    const res1 = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res1.status, 200);

    // 2nd assignment for same delivery
    const res2 = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res2.status, 409);
    assert.match((await res2.json()).message, /status is 'assigned' \(must be 'pending'\)/i);
  });

  // 10. Concurrent assignment requests competing for the same resource
  await t.test('Test 10: Concurrent assignment requests competing for same vehicle results in exactly 1 success', async () => {
    const sharedVeh = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-CONCUR-V', type: 'Van', capacity: 1000 })
    })).json();

    const d1 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Racer 1', phone: '+1-555-7011' })
    })).json();

    const d2 = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Racer 2', phone: '+1-555-7012' })
    })).json();

    const del1 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Race A', dropoff_address: 'Dest A', scheduled_time: '2026-11-11T10:00:00Z' })
    })).json();

    const del2 = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Race B', dropoff_address: 'Dest B', scheduled_time: '2026-11-11T11:00:00Z' })
    })).json();

    // Fire both assignments simultaneously
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/deliveries/${del1.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: d1.id })
      }),
      fetch(`${baseUrl}/deliveries/${del2.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: sharedVeh.id, driver_id: d2.id })
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Exactly one assignment must succeed with 200, one must fail with 409');

    // Verify DB partial unique constraint integrity
    const db = getDb();
    const activeAssignments = db.prepare('SELECT COUNT(*) AS count FROM assignments WHERE vehicle_id = ? AND is_active = 1').get(sharedVeh.id);
    assert.equal(activeAssignments.count, 1, 'Physical database index guarantees exactly 1 active assignment');
  });

  // 11. Database rollback after a failed assignment
  await t.test('Test 11: Database rollback after a failed assignment leaves zero dirty records', async () => {
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-ROLLBACK-V', type: 'Van', capacity: 500 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rollback Driver', phone: '+1-555-7013' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'A',
        dropoff_address: 'B',
        scheduled_time: '2026-11-11T12:00:00Z',
        required_capacity: 1500 // Capacity mismatch will cause rollback
      })
    })).json();

    // Count records before attempt
    const db = getDb();
    const countAssignmentsBefore = db.prepare('SELECT COUNT(*) AS count FROM assignments').get().count;

    const res = await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });
    assert.equal(res.status, 409);

    // Verify all entity states are completely untouched
    const countAssignmentsAfter = db.prepare('SELECT COUNT(*) AS count FROM assignments').get().count;
    assert.equal(countAssignmentsAfter, countAssignmentsBefore, 'No orphan assignment records created');

    const vDb = db.prepare('SELECT status FROM vehicles WHERE id = ?').get(v.id);
    const dDb = db.prepare('SELECT availability_status FROM drivers WHERE id = ?').get(d.id);
    const delDb = db.prepare('SELECT status FROM deliveries WHERE id = ?').get(del.id);

    assert.equal(vDb.status, 'available');
    assert.equal(dDb.availability_status, 'available');
    assert.equal(delDb.status, 'pending');
  });

  // 12. Persistence after application restart
  await t.test('Test 12: Persistence verified by closing and reopening database connection', async () => {
    const testPersistDb = path.join(__dirname, '..', 'data', 'p7_persist_verify.db');
    if (fs.existsSync(testPersistDb)) fs.unlinkSync(testPersistDb);
    if (fs.existsSync(`${testPersistDb}-wal`)) fs.unlinkSync(`${testPersistDb}-wal`);
    if (fs.existsSync(`${testPersistDb}-shm`)) fs.unlinkSync(`${testPersistDb}-shm`);

    // Attach disk DB
    const { initDatabase, setDb } = require('../src/db/database');
    setDb(initDatabase(testPersistDb));

    // 1. Create entities and an active assignment
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'P7-PERSIST-V', type: 'Truck', capacity: 3000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Persist Driver', phone: '+1-555-7014' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Persist Hub', dropoff_address: 'Persist Client', scheduled_time: '2026-11-12T09:00:00Z' })
    })).json();

    await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    // 2. Simulate application shutdown (closing file handle)
    closeDb();

    // 3. Re-open through fresh database connection from disk file
    setDb(initDatabase(testPersistDb));

    // 4. Verify data and active assignment survived restart
    const checkDel = await (await fetch(`${baseUrl}/deliveries/${del.id}`)).json();
    assert.equal(checkDel.status, 'assigned');
    assert.ok(checkDel.assignment);
    assert.equal(checkDel.assignment.vehicle.registration_number, 'P7-PERSIST-V');
    assert.equal(checkDel.assignment.driver.name, 'Persist Driver');

    const checkVeh = await (await fetch(`${baseUrl}/vehicles/${v.id}`)).json();
    assert.equal(checkVeh.status, 'assigned');
    assert.equal(checkVeh.active_delivery.delivery_id, del.id);

    // Clean up
    closeDb();
    try {
      if (fs.existsSync(testPersistDb)) fs.unlinkSync(testPersistDb);
      if (fs.existsSync(`${testPersistDb}-wal`)) fs.unlinkSync(`${testPersistDb}-wal`);
      if (fs.existsSync(`${testPersistDb}-shm`)) fs.unlinkSync(`${testPersistDb}-shm`);
    } catch (_) {}

    // Restore test in-memory DB for following tests
    resetDbForTesting();
  });

  // 13. Frontend/API integration and regression testing
  await t.test('Test 13: Frontend/API integration and regression workflow', async () => {
    // Check static files
    const resHtml = await fetch(`${baseUrl}/`);
    assert.equal(resHtml.status, 200);
    const html = await resHtml.text();
    assert.ok(html.includes('FleetWise'));
    assert.ok(html.includes('id="queueTable"'));
    assert.ok(html.includes('id="anlFleetRate"'));
    assert.ok(html.includes('id="auditTable"'));

    // Check seed API
    const resSeed = await fetch(`${baseUrl}/api/seed`, { method: 'POST' });
    assert.equal(resSeed.status, 200);

    // Check dashboard statistics
    const resStats = await fetch(`${baseUrl}/api/dashboard/stats`);
    assert.equal(resStats.status, 200);
    const stats = await resStats.json();
    assert.ok(stats.vehicles.total > 0);
    assert.ok(stats.drivers.total > 0);
    assert.ok(stats.deliveries.total > 0);

    // Check priority queue endpoint
    const resQueue = await fetch(`${baseUrl}/deliveries/queue`);
    assert.equal(resQueue.status, 200);
    const queue = await resQueue.json();
    assert.ok(Array.isArray(queue.queue));

    // Check performance analytics endpoint
    const resPerf = await fetch(`${baseUrl}/api/analytics/performance`);
    assert.equal(resPerf.status, 200);
    const perf = await resPerf.json();
    assert.ok(perf.fleet_utilization.total_vehicles >= stats.vehicles.total);

    // Check audit logs endpoint
    const resAudit = await fetch(`${baseUrl}/api/audit-logs`);
    assert.equal(resAudit.status, 200);
    const audit = await resAudit.json();
    assert.ok(audit.count > 0);
  });
});

