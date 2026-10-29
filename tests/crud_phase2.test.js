const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { resetDbForTesting } = require('../src/db/database');

test('Phase 2 - Complete CRUD Operations & Safe Edit/Delete Safeguards', async (t) => {
  resetDbForTesting();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  // ==========================================
  // 1. VEHICLE CRUD & SAFE DELETION TESTS
  // ==========================================
  await t.test('Vehicle CRUD: create, read, update, delete safe, and reject unsafe', async () => {
    // Create vehicle 1
    const createRes1 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_number: 'CRUD-V1',
        type: 'Cargo Van',
        capacity: 1200,
        status: 'available'
      })
    });
    assert.equal(createRes1.status, 201);
    const v1 = await createRes1.json();
    assert.equal(v1.registration_number, 'CRUD-V1');

    // Create vehicle 2
    const createRes2 = await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_number: 'CRUD-V2',
        type: 'Flatbed Truck',
        capacity: 3500,
        status: 'available'
      })
    });
    assert.equal(createRes2.status, 201);
    const v2 = await createRes2.json();

    // Read by ID
    const getRes = await fetch(`${baseUrl}/vehicles/${v1.id}`);
    assert.equal(getRes.status, 200);
    const fetchedV1 = await getRes.json();
    assert.equal(fetchedV1.registration_number, 'CRUD-V1');
    assert.equal(fetchedV1.active_delivery, null);

    // Update vehicle 1 details
    const updateRes = await fetch(`${baseUrl}/vehicles/${v1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_number: 'CRUD-V1-MOD',
        type: 'Heavy Cargo Van',
        capacity: 1600,
        status: 'available'
      })
    });
    assert.equal(updateRes.status, 200);
    const updatedV1 = await updateRes.json();
    assert.equal(updatedV1.registration_number, 'CRUD-V1-MOD');
    assert.equal(updatedV1.capacity, 1600);

    // Reject conflicting registration number update
    const conflictUpdate = await fetch(`${baseUrl}/vehicles/${v1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_number: 'CRUD-V2' // Already taken by v2
      })
    });
    assert.equal(conflictUpdate.status, 409);

    // Delete unassigned vehicle 2 safely
    const delV2Res = await fetch(`${baseUrl}/vehicles/${v2.id}`, { method: 'DELETE' });
    assert.equal(delV2Res.status, 200);

    // Verify v2 is gone
    const checkDeleted = await fetch(`${baseUrl}/vehicles/${v2.id}`);
    assert.equal(checkDeleted.status, 404);
  });

  // ==========================================
  // 2. DRIVER CRUD & SAFE DELETION TESTS
  // ==========================================
  await t.test('Driver CRUD: create, read, update, delete safe, and enforce unique ID & phone', async () => {
    // Create driver 1 with explicit ID
    const createRes1 = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'DRV-SPEC-001',
        name: 'Jordan Miller',
        phone: '+1-555-4401',
        availability_status: 'available'
      })
    });
    assert.equal(createRes1.status, 201);
    const d1 = await createRes1.json();
    assert.equal(d1.id, 'DRV-SPEC-001');

    // Reject duplicate driver ID
    const dupIdRes = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'DRV-SPEC-001',
        name: 'Imposter Driver',
        phone: '+1-555-4402'
      })
    });
    assert.equal(dupIdRes.status, 409);

    // Create driver 2
    const createRes2 = await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Morgan Blake',
        phone: '+1-555-4403',
        availability_status: 'available'
      })
    });
    assert.equal(createRes2.status, 201);
    const d2 = await createRes2.json();

    // Update driver 1 details
    const updateRes = await fetch(`${baseUrl}/drivers/${d1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jordan Miller Senior',
        phone: '+1-555-4499'
      })
    });
    assert.equal(updateRes.status, 200);
    const updatedD1 = await updateRes.json();
    assert.equal(updatedD1.name, 'Jordan Miller Senior');
    assert.equal(updatedD1.phone, '+1-555-4499');

    // Reject duplicate phone update
    const dupPhoneUpdate = await fetch(`${baseUrl}/drivers/${d1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '+1-555-4403' // Owned by d2
      })
    });
    assert.equal(dupPhoneUpdate.status, 409);

    // Delete unassigned driver 2 safely
    const delD2Res = await fetch(`${baseUrl}/drivers/${d2.id}`, { method: 'DELETE' });
    assert.equal(delD2Res.status, 200);

    // Verify d2 is gone
    const checkDeleted = await fetch(`${baseUrl}/drivers/${d2.id}`);
    assert.equal(checkDeleted.status, 404);
  });

  // ==========================================
  // 3. DELIVERY CRUD & EDIT SAFEGUARDS
  // ==========================================
  await t.test('Delivery CRUD: create pending, read, update pending, delete safe, and block active edits', async () => {
    // Create pending delivery
    const createRes = await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Original Depot A',
        dropoff_address: 'Original Client B',
        scheduled_time: '2026-11-01T15:00:00Z',
        priority: 'medium',
        notes: 'Handle with care'
      })
    });
    assert.equal(createRes.status, 201);
    const del = await createRes.json();
    assert.equal(del.status, 'pending');

    // Read delivery
    const getRes = await fetch(`${baseUrl}/deliveries/${del.id}`);
    assert.equal(getRes.status, 200);
    const fetchedDel = await getRes.json();
    assert.equal(fetchedDel.pickup_address, 'Original Depot A');

    // Update pending delivery route and priority
    const updateRes = await fetch(`${baseUrl}/deliveries/${del.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Updated Depot A',
        dropoff_address: 'Updated Client B',
        scheduled_time: '2026-11-01T16:00:00Z',
        priority: 'urgent',
        notes: 'Rush priority'
      })
    });
    assert.equal(updateRes.status, 200);
    const updatedDel = await updateRes.json();
    assert.equal(updatedDel.pickup_address, 'Updated Depot A');
    assert.equal(updatedDel.priority, 'urgent');

    // Delete unassigned delivery safely
    const delRes = await fetch(`${baseUrl}/deliveries/${del.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // Verify delivery is gone
    const checkDeleted = await fetch(`${baseUrl}/deliveries/${del.id}`);
    assert.equal(checkDeleted.status, 404);
  });

  // ==========================================
  // 4. ACTIVE ASSIGNMENT EDIT/DELETE BLOCKING
  // ==========================================
  await t.test('Reject unsafe edits and deletions when resources are actively assigned', async () => {
    // Create vehicle, driver, and delivery
    const v = await (await fetch(`${baseUrl}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_number: 'SAFE-V1', type: 'Van', capacity: 1000 })
    })).json();

    const d = await (await fetch(`${baseUrl}/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Active Driver', phone: '+1-555-9911' })
    })).json();

    const del = await (await fetch(`${baseUrl}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup_address: 'Hub 1',
        dropoff_address: 'Hub 2',
        scheduled_time: '2026-11-02T10:00:00Z'
      })
    })).json();

    // Assign delivery
    await fetch(`${baseUrl}/deliveries/${del.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: v.id, driver_id: d.id })
    });

    // 1. Unsafe Vehicle Deletion Blocked
    const delVehRes = await fetch(`${baseUrl}/vehicles/${v.id}`, { method: 'DELETE' });
    assert.equal(delVehRes.status, 409);
    const delVehBody = await delVehRes.json();
    assert.match(delVehBody.message, /cannot delete vehicle/i);

    // 2. Unsafe Driver Deletion Blocked
    const delDrvRes = await fetch(`${baseUrl}/drivers/${d.id}`, { method: 'DELETE' });
    assert.equal(delDrvRes.status, 409);
    const delDrvBody = await delDrvRes.json();
    assert.match(delDrvBody.message, /cannot delete driver/i);

    // 3. Unsafe Delivery Deletion Blocked
    const delDelRes = await fetch(`${baseUrl}/deliveries/${del.id}`, { method: 'DELETE' });
    assert.equal(delDelRes.status, 409);
    const delDelBody = await delDelRes.json();
    assert.match(delDelBody.message, /cannot delete delivery/i);

    // 4. Unsafe Delivery Edit Blocked while Active
    const editDelRes = await fetch(`${baseUrl}/deliveries/${del.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_address: 'Tampered Address' })
    });
    assert.equal(editDelRes.status, 409);
    const editDelBody = await editDelRes.json();
    assert.match(editDelBody.message, /cannot edit core route details/i);

    // 5. Unsafe Vehicle Modification (e.g. setting to maintenance while assigned) Blocked
    const editVehRes = await fetch(`${baseUrl}/vehicles/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'maintenance' })
    });
    assert.equal(editVehRes.status, 409);
  });
});
