// FarmVista — Hauling Job Schema Normalizer
// Keeps canonical and compatibility identity fields synchronized for every hauling job.
// This intentionally does not fabricate sold-under learning audit fields; those are only
// written when a ticket-learning event actually occurs.

import {
  ready,
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const clean = value => String(value ?? "").trim();

async function normalizeHaulingJobs() {
  try {
    const [jobsSnap, customersSnap, buyersSnap, locationsSnap] = await Promise.all([
      getDocs(collection(db, "grain_hauling_jobs")),
      getDocs(collection(db, "grain_customers")),
      getDocs(collection(db, "grain_buyers")),
      getDocs(collection(db, "grain_delivery_locations"))
    ]);

    const customers = new Map(customersSnap.docs.map(s => [s.id, { id: s.id, ...s.data() }]));
    const buyers = new Map(buyersSnap.docs.map(s => [s.id, { id: s.id, ...s.data() }]));
    const locations = new Map(locationsSnap.docs.map(s => [s.id, { id: s.id, ...s.data() }]));

    const repairs = [];

    jobsSnap.docs.forEach(snapshot => {
      const job = snapshot.data();
      const patch = {};

      const customerId = clean(job.customerId || job.grainCustomerId);
      const buyerId = clean(job.buyerId || job.grainBuyerId);
      const locationId = clean(job.deliveryLocationId || job.locationId || job.destinationId);
      const crop = clean(job.crop || job.commodity || job.cropName || job.cropType);

      const customer = customers.get(customerId);
      const buyer = buyers.get(buyerId);
      const location = locations.get(locationId);

      // Sold Under: customerId is canonical; grainCustomerId remains synchronized
      // because ticket/legacy assignment paths still read it.
      if (customerId && clean(job.customerId) !== customerId) patch.customerId = customerId;
      if (customerId && clean(job.grainCustomerId) !== customerId) patch.grainCustomerId = customerId;
      if (customer && clean(job.customerName) !== clean(customer.name)) patch.customerName = clean(customer.name);

      // Buyer compatibility fields.
      if (buyerId && clean(job.buyerId) !== buyerId) patch.buyerId = buyerId;
      if (buyerId && clean(job.grainBuyerId) && clean(job.grainBuyerId) !== buyerId) patch.grainBuyerId = buyerId;
      if (buyer && !clean(job.buyerName)) patch.buyerName = clean(buyer.name);

      // Delivery location canonical identity/name. Never guess a location from buyer alone.
      if (locationId && clean(job.deliveryLocationId) !== locationId) patch.deliveryLocationId = locationId;
      if (location) {
        const locationName = clean(location.locationName || location.name);
        if (locationName && clean(job.deliveryLocationName) !== locationName) patch.deliveryLocationName = locationName;
      }

      // Crop aliases are intentionally synchronized because older ticket paths use commodity.
      if (crop && clean(job.crop) !== crop) patch.crop = crop;
      if (crop && clean(job.commodity) !== crop) patch.commodity = crop;

      if (Object.keys(patch).length) {
        patch.schemaNormalizedAt = serverTimestamp();
        repairs.push(updateDoc(doc(db, "grain_hauling_jobs", snapshot.id), patch));
      }
    });

    if (repairs.length) {
      await Promise.all(repairs);
      console.info(`[FarmVista] Normalized ${repairs.length} hauling job record(s).`);
      document.dispatchEvent(new CustomEvent("fv:hauling-jobs-normalized"));
    }
  } catch (error) {
    console.warn("[FarmVista] Hauling job schema normalization failed:", error);
  }
}

normalizeHaulingJobs();

document.addEventListener("fv:hauling-job-saved", () => {
  setTimeout(normalizeHaulingJobs, 250);
});
