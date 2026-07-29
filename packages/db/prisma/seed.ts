/* eslint-disable no-console -- dev seed script, not runtime code */
/**
 * Idempotent seed — safe to run any number of times (everything is upsert-
 * or update-based). Seeds REFERENCE data only: catalog, zones, partners,
 * plans, price rules, safety scripts, two test users. Transactional tables
 * (bookings, jobs, payments…) are left empty on purpose — they are created
 * by real flows (see docs/DECISIONS.md D-006).
 *
 * ₹ prices come from docs/PLAN.md §2.2 and are INDICATIVE ANCHORS —
 * PLAN.md §11.1: calibrate against local competitors before launch.
 */
import {
  MaterialsPolicy,
  PartnerToolType,
  PricingModel,
  PrismaClient,
  SkillTier,
  UrgencyTier,
} from '@prisma/client';

const prisma = new PrismaClient();

/** whole rupees → bigint paise */
const r = (rupeesWhole: number): bigint => BigInt(rupeesWhole) * 100n;

/** A SKU's max urgency implies eligibility for that tier and all slower ones. */
function urgencyFrom(max: UrgencyTier): UrgencyTier[] {
  const order: UrgencyTier[] = ['E0', 'E1', 'E2', 'E3'];
  return order.slice(order.indexOf(max));
}

// ─────────────────────────── catalog data ───────────────────────────

const CATEGORIES = [
  { code: 'LEAK', name: 'Leak & Pipe Repair', sortOrder: 1 },
  { code: 'DRN', name: 'Drainage & Blockage', sortOrder: 2 },
  { code: 'BTH', name: 'Bathroom Fittings', sortOrder: 3 },
  { code: 'TOI', name: 'Toilet & Sanitaryware', sortOrder: 4 },
  { code: 'KIT', name: 'Kitchen Plumbing', sortOrder: 5 },
  { code: 'TNK', name: 'Tank, Motor & Pump', sortOrder: 6 },
  { code: 'GYS', name: 'Water Heater / Geyser', sortOrder: 7 },
  { code: 'PIP', name: 'New Installation & Pipelines', sortOrder: 8 },
  { code: 'PUR', name: 'Water Purifier & Softener', sortOrder: 9 },
  { code: 'AMC', name: 'Inspection, AMC & Audits', sortOrder: 10 },
] as const;

interface SkuSeed {
  sku: string;
  name: string;
  model: PricingModel;
  priceR?: number; // whole ₹; undefined for QUOTE_ONLY
  unitLabel?: string;
  visitR?: number; // whole ₹ visit charge if customer declines quote
  durMin: number;
  tier: SkillTier;
  materials?: MaterialsPolicy;
  maxUrgency?: UrgencyTier; // default E2
  tools?: PartnerToolType[];
  warrantyDays?: number;
  preVisit?: unknown[];
}

// Pre-visit diagnostic questions (PLAN.md §2.3) — kept to ≤4 per SKU.
const PREVISIT_WC_BLOCKAGE = [
  {
    q: 'Is water draining slowly, or not at all?',
    options: ['Slowly', 'Not at all'],
    effect: { 'Not at all': { addTools: ['CLOSET_AUGER'] } },
  },
  {
    q: 'Is water overflowing onto the floor right now?',
    options: ['Yes', 'No'],
    effect: { Yes: { promoteUrgency: 'E1' } },
  },
  {
    q: 'Is this the only toilet in the house?',
    options: ['Yes', 'No'],
    effect: { Yes: { promoteUrgency: 'E1' } },
  },
  {
    q: 'Did anything get flushed that should not have been? (cloth / toy / sanitary item)',
    options: ['Yes', 'No'],
    effect: { Yes: { addOnChip: { label: 'Foreign object retrieval', pricePaise: '20000' } } },
  },
];

const PREVISIT_CONCEALED_LEAK = [
  {
    q: 'Where do you see dampness?',
    options: ['Ceiling', 'Wall', 'Floor', 'Near meter'],
  },
  {
    q: 'Is the floor below also affected?',
    options: ['Yes', 'No'],
    effect: { Yes: { flag: 'possible slab leak', minTier: 'L3' } },
  },
  { q: 'Has the water bill jumped recently?', options: ['Yes', 'No', 'Not sure'] },
  {
    q: 'Upload a photo/video of the damp patch (optional)',
    type: 'media',
    optional: true,
  },
];

const SKUS: Record<string, SkuSeed[]> = {
  LEAK: [
    {
      sku: 'PLB-LEAK-001',
      name: 'Tap / faucet leak repair',
      model: 'FROM',
      priceR: 199,
      durMin: 30,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
    },
    {
      sku: 'PLB-LEAK-002',
      name: "Tap replacement (customer's tap)",
      model: 'FIXED',
      priceR: 249,
      durMin: 30,
      tier: 'L2',
    },
    {
      sku: 'PLB-LEAK-003',
      name: 'Visible pipe leak repair (CPVC/UPVC/GI)',
      model: 'FROM',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-LEAK-004',
      name: 'Concealed leak detection (wall/floor)',
      model: 'INSPECTION_FIRST',
      priceR: 599,
      durMin: 60,
      tier: 'L3',
      maxUrgency: 'E1',
      tools: ['LEAK_DETECTOR'],
      preVisit: PREVISIT_CONCEALED_LEAK,
    },
    {
      sku: 'PLB-LEAK-005',
      name: 'Concealed pipe repair (post-detection)',
      model: 'QUOTE_ONLY',
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-LEAK-006',
      name: 'Joint / elbow leak sealing',
      model: 'FROM',
      priceR: 249,
      durMin: 30,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
    },
    {
      sku: 'PLB-LEAK-007',
      name: 'Burst pipe emergency repair',
      model: 'FROM',
      priceR: 899,
      durMin: 60,
      tier: 'L3',
      materials: 'CONSUMABLES_ONLY',
      maxUrgency: 'E0',
    },
    {
      sku: 'PLB-LEAK-008',
      name: 'Water meter / inlet valve replacement',
      model: 'FROM',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-LEAK-009',
      name: 'Stopcock / main valve replacement',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
      maxUrgency: 'E1',
    },
  ],
  DRN: [
    {
      sku: 'PLB-DRN-001',
      name: 'Kitchen sink unclogging (manual)',
      model: 'FIXED',
      priceR: 349,
      durMin: 30,
      tier: 'L2',
    },
    {
      sku: 'PLB-DRN-002',
      name: 'Kitchen sink unclogging (drain machine)',
      model: 'FIXED',
      priceR: 699,
      durMin: 60,
      tier: 'L2',
      maxUrgency: 'E1',
      tools: ['DRAIN_MACHINE'],
    },
    {
      sku: 'PLB-DRN-003',
      name: 'Bathroom floor drain unclogging',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
    },
    {
      sku: 'PLB-DRN-004',
      name: 'WC blockage clearing',
      model: 'FIXED',
      priceR: 499,
      durMin: 45,
      tier: 'L2',
      maxUrgency: 'E1',
      tools: ['CLOSET_AUGER'],
      preVisit: PREVISIT_WC_BLOCKAGE,
    },
    {
      sku: 'PLB-DRN-005',
      name: 'Sewer line jetting (external)',
      model: 'FROM',
      priceR: 1999,
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E1',
      tools: ['JETTING_UNIT'],
    },
    {
      sku: 'PLB-DRN-006',
      name: 'P-trap / bottle trap replacement',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
    },
    {
      sku: 'PLB-DRN-007',
      name: 'Balcony / terrace drain cleaning',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    // Machine-cleaning ONLY + PPE — manual sewer entry is illegal (hard block, see BUILD-PROMPT "SAFETY CONTENT").
    {
      sku: 'PLB-DRN-008',
      name: 'Sewage backflow emergency',
      model: 'FROM',
      priceR: 1499,
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E0',
      tools: ['JETTING_UNIT', 'PPE_KIT'],
    },
    {
      sku: 'PLB-DRN-009',
      name: 'Manhole / chamber cleaning (machine-only)',
      model: 'FROM',
      priceR: 1499,
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E1',
      tools: ['JETTING_UNIT', 'PPE_KIT'],
    },
  ],
  BTH: [
    {
      sku: 'PLB-BTH-001',
      name: 'Tap installation',
      model: 'PER_UNIT',
      priceR: 199,
      unitLabel: 'per tap',
      durMin: 20,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-002',
      name: 'Shower / rain shower installation',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-003',
      name: 'Health faucet install / replace',
      model: 'FIXED',
      priceR: 249,
      durMin: 20,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-004',
      name: 'Wall mixer / diverter installation',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-005',
      name: 'Overhead shower arm fitting',
      model: 'FIXED',
      priceR: 299,
      durMin: 30,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-006',
      name: 'Angle valve replacement',
      model: 'PER_UNIT',
      priceR: 199,
      unitLabel: 'per valve',
      durMin: 20,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-007',
      name: 'Towel rod / soap dish / hook fitting',
      model: 'PER_UNIT',
      priceR: 149,
      unitLabel: 'per fitting',
      durMin: 15,
      tier: 'L1',
    },
    {
      sku: 'PLB-BTH-008',
      name: 'Full bathroom fittings set installation',
      model: 'FROM',
      priceR: 1499,
      durMin: 180,
      tier: 'L3',
    },
    {
      sku: 'PLB-BTH-009',
      name: 'Wash basin installation',
      model: 'FIXED',
      priceR: 699,
      durMin: 90,
      tier: 'L2',
    },
    {
      sku: 'PLB-BTH-010',
      name: 'Wash basin removal / refit',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L2',
    },
  ],
  TOI: [
    {
      sku: 'PLB-TOI-001',
      name: 'Western WC installation',
      model: 'FIXED',
      priceR: 1299,
      durMin: 120,
      tier: 'L3',
    },
    {
      sku: 'PLB-TOI-002',
      name: 'Indian WC installation',
      model: 'FIXED',
      priceR: 1499,
      durMin: 180,
      tier: 'L3',
    },
    {
      sku: 'PLB-TOI-003',
      name: 'Concealed flush tank repair',
      model: 'FROM',
      priceR: 599,
      durMin: 90,
      tier: 'L3',
      materials: 'CONSUMABLES_ONLY',
    },
    {
      sku: 'PLB-TOI-004',
      name: 'External flush tank repair',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
    },
    {
      sku: 'PLB-TOI-005',
      name: 'WC seat cover replacement',
      model: 'FIXED',
      priceR: 249,
      durMin: 20,
      tier: 'L1',
    },
    {
      sku: 'PLB-TOI-006',
      name: 'Jet spray installation',
      model: 'FIXED',
      priceR: 249,
      durMin: 20,
      tier: 'L2',
    },
    {
      sku: 'PLB-TOI-007',
      name: 'WC removal & refit (for tiling work)',
      model: 'FIXED',
      priceR: 999,
      durMin: 120,
      tier: 'L3',
    },
    {
      sku: 'PLB-TOI-008',
      name: 'Urinal / bidet installation',
      model: 'FIXED',
      priceR: 899,
      durMin: 120,
      tier: 'L3',
    },
  ],
  KIT: [
    {
      sku: 'PLB-KIT-001',
      name: 'Kitchen sink installation',
      model: 'FIXED',
      priceR: 699,
      durMin: 90,
      tier: 'L2',
    },
    {
      sku: 'PLB-KIT-002',
      name: 'Kitchen tap installation',
      model: 'FIXED',
      priceR: 249,
      durMin: 30,
      tier: 'L2',
    },
    {
      sku: 'PLB-KIT-003',
      name: 'Sink waste coupling / drain pipe replacement',
      model: 'FIXED',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
    },
    {
      sku: 'PLB-KIT-004',
      name: 'RO / purifier plumbing point',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L2',
    },
    {
      sku: 'PLB-KIT-005',
      name: 'Washing machine / dishwasher inlet-outlet point',
      model: 'FIXED',
      priceR: 599,
      durMin: 60,
      tier: 'L2',
    },
    {
      sku: 'PLB-KIT-006',
      name: 'Under-sink leak repair',
      model: 'FROM',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
    },
  ],
  TNK: [
    {
      sku: 'PLB-TNK-001',
      name: 'Overhead tank cleaning (up to 1000 L)',
      model: 'PER_UNIT',
      priceR: 899,
      unitLabel: 'per 1000 L',
      durMin: 90,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-TNK-002',
      name: 'Sump / underground tank cleaning',
      model: 'FROM',
      priceR: 1999,
      durMin: 180,
      tier: 'L2',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-TNK-003',
      name: 'Water pump installation',
      model: 'FIXED',
      priceR: 899,
      durMin: 120,
      tier: 'L3',
    },
    {
      sku: 'PLB-TNK-004',
      name: 'Pump repair / servicing',
      model: 'INSPECTION_FIRST',
      priceR: 599,
      durMin: 90,
      tier: 'L3',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-TNK-005',
      name: 'Float valve / ball cock replacement',
      model: 'FIXED',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-TNK-006',
      name: 'Automatic water level controller install',
      model: 'FIXED',
      priceR: 1299,
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-TNK-007',
      name: 'Tank inlet / outlet pipe repair',
      model: 'FROM',
      priceR: 499,
      durMin: 90,
      tier: 'L2',
      materials: 'CONSUMABLES_ONLY',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-TNK-008',
      name: 'Pressure booster pump installation',
      model: 'FROM',
      priceR: 1999,
      durMin: 180,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-TNK-009',
      name: 'Tank overflow / no water supply emergency',
      model: 'FROM',
      priceR: 699,
      durMin: 60,
      tier: 'L2',
      maxUrgency: 'E0',
    },
  ],
  GYS: [
    {
      sku: 'PLB-GYS-001',
      name: 'Storage geyser installation',
      model: 'FIXED',
      priceR: 599,
      durMin: 90,
      tier: 'L2',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-GYS-002',
      name: 'Instant geyser installation',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L2',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-GYS-003',
      name: 'Geyser uninstallation',
      model: 'FIXED',
      priceR: 349,
      durMin: 45,
      tier: 'L2',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-GYS-004',
      name: 'Geyser repair (diagnosis)',
      model: 'INSPECTION_FIRST',
      priceR: 299,
      durMin: 60,
      tier: 'L3',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-GYS-005',
      name: 'Geyser descaling / servicing',
      model: 'FIXED',
      priceR: 699,
      durMin: 90,
      tier: 'L2',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-GYS-006',
      name: 'Thermostat / heating element replacement',
      model: 'FROM',
      priceR: 499,
      durMin: 90,
      tier: 'L3',
      maxUrgency: 'E1',
    },
    {
      sku: 'PLB-GYS-007',
      name: 'Geyser leaking / electrical hazard',
      model: 'FROM',
      priceR: 799,
      durMin: 60,
      tier: 'L3',
      maxUrgency: 'E0',
    },
  ],
  PIP: [
    {
      sku: 'PLB-PIP-001',
      name: 'New bathroom plumbing (full)',
      model: 'QUOTE_ONLY',
      visitR: 499,
      durMin: 480,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PIP-002',
      name: 'CPVC pipeline laying — open',
      model: 'PER_UNIT',
      priceR: 499,
      unitLabel: 'per point',
      durMin: 60,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PIP-003',
      name: 'Concealed piping',
      model: 'PER_UNIT',
      priceR: 899,
      unitLabel: 'per point',
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E3',
      tools: ['CORE_DRILL'],
    },
    {
      sku: 'PLB-PIP-004',
      name: 'Pipe rerouting / relocation',
      model: 'FROM',
      priceR: 1499,
      durMin: 180,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PIP-005',
      name: 'Borewell to tank connection',
      model: 'QUOTE_ONLY',
      durMin: 240,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PIP-006',
      name: 'Rainwater harvesting connection',
      model: 'QUOTE_ONLY',
      durMin: 240,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PIP-007',
      name: 'Terrace / garden tap point',
      model: 'FIXED',
      priceR: 599,
      durMin: 90,
      tier: 'L2',
    },
  ],
  PUR: [
    {
      sku: 'PLB-PUR-001',
      name: 'Water purifier installation',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L2',
    },
    {
      sku: 'PLB-PUR-002',
      name: 'Purifier uninstall + reinstall (shifting)',
      model: 'FIXED',
      priceR: 699,
      durMin: 90,
      tier: 'L2',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PUR-003',
      name: 'Water softener installation',
      model: 'FROM',
      priceR: 1999,
      durMin: 180,
      tier: 'L3',
      maxUrgency: 'E3',
    },
    {
      sku: 'PLB-PUR-004',
      name: 'Sediment / pre-filter housing installation',
      model: 'FIXED',
      priceR: 399,
      durMin: 45,
      tier: 'L2',
    },
  ],
  AMC: [
    {
      sku: 'PLB-AMC-001',
      name: 'Home plumbing health check',
      model: 'FIXED',
      priceR: 499,
      durMin: 60,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-AMC-002',
      name: 'Pre-monsoon drainage check',
      model: 'FIXED',
      priceR: 699,
      durMin: 90,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-AMC-003',
      name: 'AMC Basic — 2 visits/yr',
      model: 'SUBSCRIPTION',
      priceR: 1999,
      durMin: 60,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-AMC-004',
      name: 'AMC Plus — 4 visits/yr',
      model: 'SUBSCRIPTION',
      priceR: 3999,
      durMin: 60,
      tier: 'L1',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
    {
      sku: 'PLB-AMC-005',
      name: 'Apartment / B2B facility AMC',
      model: 'QUOTE_ONLY',
      durMin: 120,
      tier: 'L3',
      maxUrgency: 'E3',
      warrantyDays: 0,
    },
  ],
};

// ─────────────────────────── zones & people ───────────────────────────

const ZONES = [
  {
    city: 'Bengaluru',
    name: 'Koramangala–HSR',
    wkt: 'POLYGON((77.60 12.89,77.66 12.89,77.66 12.945,77.60 12.945,77.60 12.89))',
  },
  {
    city: 'Bengaluru',
    name: 'Indiranagar',
    wkt: 'POLYGON((77.62 12.95,77.67 12.95,77.67 12.99,77.62 12.99,77.62 12.95))',
  },
  {
    city: 'Bengaluru',
    name: 'Whitefield',
    wkt: 'POLYGON((77.71 12.94,77.78 12.94,77.78 13.00,77.71 13.00,77.71 12.94))',
  },
] as const;

interface PartnerSeed {
  phone: string;
  name: string;
  tier: SkillTier;
  zone: (typeof ZONES)[number]['name'];
  emergencyOptIn: boolean;
  categories: string[]; // certified category codes
  tools: PartnerToolType[];
  rating: number;
}

const PARTNERS: PartnerSeed[] = [
  {
    phone: '+919800000001',
    name: 'Ravi Kumar',
    tier: 'L3',
    zone: 'Koramangala–HSR',
    emergencyOptIn: true,
    categories: ['LEAK', 'DRN', 'TNK'],
    tools: ['JETTING_UNIT', 'DRAIN_MACHINE', 'PPE_KIT'],
    rating: 4.8,
  },
  {
    phone: '+919800000002',
    name: 'Suresh Gowda',
    tier: 'L3',
    zone: 'Indiranagar',
    emergencyOptIn: true,
    categories: ['LEAK', 'GYS', 'TOI', 'PIP'],
    tools: ['LEAK_DETECTOR', 'CORE_DRILL'],
    rating: 4.7,
  },
  {
    phone: '+919800000003',
    name: 'Manjunath S',
    tier: 'L2',
    zone: 'Koramangala–HSR',
    emergencyOptIn: false,
    categories: ['LEAK', 'BTH', 'KIT'],
    tools: [],
    rating: 4.5,
  },
  {
    phone: '+919800000004',
    name: 'Abdul Rahman',
    tier: 'L2',
    zone: 'Whitefield',
    emergencyOptIn: true,
    categories: ['DRN', 'TOI'],
    tools: ['CLOSET_AUGER', 'DRAIN_MACHINE'],
    rating: 4.6,
  },
  {
    phone: '+919800000005',
    name: 'Prakash Reddy',
    tier: 'L2',
    zone: 'Whitefield',
    emergencyOptIn: false,
    categories: ['TNK', 'GYS'],
    tools: [],
    rating: 4.3,
  },
  {
    phone: '+919800000006',
    name: 'Venkatesh N',
    tier: 'L2',
    zone: 'Indiranagar',
    emergencyOptIn: false,
    categories: ['KIT', 'BTH', 'PUR'],
    tools: [],
    rating: 4.4,
  },
  {
    phone: '+919800000007',
    name: 'Mohan Das',
    tier: 'L2',
    zone: 'Koramangala–HSR',
    emergencyOptIn: true,
    categories: ['LEAK', 'DRN'],
    tools: ['DRAIN_MACHINE'],
    rating: 4.2,
  },
  {
    phone: '+919800000008',
    name: 'Krishna Murthy',
    tier: 'L1',
    zone: 'Indiranagar',
    emergencyOptIn: false,
    categories: ['BTH', 'AMC'],
    tools: [],
    rating: 4.1,
  },
  {
    phone: '+919800000009',
    name: 'Shankar P',
    tier: 'L1',
    zone: 'Whitefield',
    emergencyOptIn: false,
    categories: ['TNK', 'DRN'],
    tools: ['PPE_KIT'],
    rating: 4.0,
  },
  {
    phone: '+919800000010',
    name: 'Iliyas Khan',
    tier: 'L1',
    zone: 'Koramangala–HSR',
    emergencyOptIn: false,
    categories: ['AMC', 'BTH'],
    tools: [],
    rating: 4.2,
  },
];

// Safety scripts: placeholders ONLY. reviewedAt stays NULL, which the serving
// layer must treat as "never render in production" (hard flag, tested).
// A licensed plumber + safety consultant must author/approve the real copy.
const SAFETY_SCRIPTS = [
  {
    issueType: 'BURST_PIPE',
    draft:
      'Close the main stopcock (usually near the meter or the terrace tank outlet). Switch off power to any socket near the water. Move electricals off the floor.',
  },
  {
    issueType: 'GEYSER_LEAK',
    draft:
      'Switch off the geyser MCB at the distribution board FIRST — do not touch the unit. Then close the inlet valve. Do not use the bathroom until the partner arrives.',
  },
  {
    issueType: 'SEWAGE_BACKFLOW',
    draft:
      'Stop all water use — no flushing, no taps, no washing machine. Keep children and pets away. Open windows. Do not pour chemicals down the drain.',
  },
  {
    issueType: 'TANK_OVERFLOW',
    draft: 'Switch off the pump at the mains. Close the inlet valve at the tank.',
  },
  {
    issueType: 'GAS_SMELL',
    draft:
      'Do not switch anything on or off. Open windows, leave the flat, and call the LPG emergency helpline (1906) before booking.',
  },
] as const;

// ─────────────────────────── seed steps ───────────────────────────

async function seedCatalog(): Promise<void> {
  const categoryIdByCode = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.serviceCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, sortOrder: c.sortOrder },
      update: { name: c.name, sortOrder: c.sortOrder },
    });
    categoryIdByCode.set(c.code, row.id);
  }

  let count = 0;
  for (const [catCode, skus] of Object.entries(SKUS)) {
    const categoryId = categoryIdByCode.get(catCode);
    if (!categoryId) throw new Error(`Unknown category ${catCode}`);
    for (const s of skus) {
      const data = {
        categoryId,
        name: s.name,
        shortDesc: s.name,
        pricingModel: s.model,
        basePricePaise: s.priceR !== undefined ? r(s.priceR) : null,
        unitLabel: s.unitLabel ?? null,
        visitChargePaise: r(s.visitR ?? (s.model === 'SUBSCRIPTION' ? 0 : 149)),
        estDurationMin: s.durMin,
        skillTier: s.tier,
        materialsPolicy: s.materials ?? 'EXCLUDED',
        warrantyDays: s.warrantyDays ?? 30,
        urgencyEligible: urgencyFrom(s.maxUrgency ?? 'E2'),
        requiredTools: s.tools ?? [],
        preVisitQuestions: (s.preVisit ?? []) as object[],
        sacCode: null, // TODO(ca-review): real SAC codes before the first invoice
        isActive: true,
      };
      await prisma.service.upsert({
        where: { sku: s.sku },
        create: { sku: s.sku, ...data },
        update: data,
      });
      count += 1;
    }
  }
  console.log(`  catalog: ${CATEGORIES.length} categories, ${count} SKUs`);
}

async function seedZones(): Promise<Map<string, string>> {
  const zoneIdByName = new Map<string, string>();
  for (const z of ZONES) {
    const row = await prisma.zoneGeofence.upsert({
      where: { city_name: { city: z.city, name: z.name } },
      create: { city: z.city, name: z.name, isServiceable: true },
      update: {},
    });
    // geography columns are written via raw SQL (Prisma Unsupported type)
    await prisma.$executeRaw`UPDATE "ZoneGeofence" SET polygon = ST_GeogFromText(${z.wkt}) WHERE id = ${row.id}`;
    zoneIdByName.set(z.name, row.id);
  }
  console.log(`  zones: ${ZONES.length} (polygons set)`);
  return zoneIdByName;
}

async function seedPartners(zoneIdByName: Map<string, string>): Promise<void> {
  const categories = await prisma.serviceCategory.findMany();
  const categoryIdByCode = new Map(categories.map((c) => [c.code, c.id]));

  for (const p of PARTNERS) {
    const partner = await prisma.partner.upsert({
      where: { phone: p.phone },
      create: {
        phone: p.phone,
        name: p.name,
        status: 'ACTIVE',
        skillTier: p.tier,
        emergencyOptIn: p.emergencyOptIn,
        homeZoneId: zoneIdByName.get(p.zone),
        ratingAvg90d: p.rating,
      },
      update: {
        name: p.name,
        skillTier: p.tier,
        emergencyOptIn: p.emergencyOptIn,
        homeZoneId: zoneIdByName.get(p.zone),
        ratingAvg90d: p.rating,
      },
    });

    for (const code of p.categories) {
      const categoryId = categoryIdByCode.get(code);
      if (!categoryId) throw new Error(`Unknown category ${code} for partner ${p.name}`);
      await prisma.partnerSkill.upsert({
        where: { partnerId_categoryId: { partnerId: partner.id, categoryId } },
        create: { partnerId: partner.id, categoryId, tier: p.tier },
        update: { tier: p.tier },
      });
    }

    for (const tool of p.tools) {
      await prisma.partnerTool.upsert({
        where: { partnerId_tool: { partnerId: partner.id, tool } },
        create: { partnerId: partner.id, tool },
        update: {},
      });
    }

    // Mon–Sat, 09:00–18:00 IST
    for (let day = 1; day <= 6; day += 1) {
      const existing = await prisma.partnerAvailability.findFirst({
        where: { partnerId: partner.id, dayOfWeek: day },
      });
      if (!existing) {
        await prisma.partnerAvailability.create({
          data: { partnerId: partner.id, dayOfWeek: day, startMin: 9 * 60, endMin: 18 * 60 },
        });
      }
    }
  }
  console.log(`  partners: ${PARTNERS.length} (skills, tools, availability)`);
}

async function seedAmcPlans(): Promise<void> {
  await prisma.aMCPlan.upsert({
    where: { code: 'AMC_BASIC' },
    create: {
      code: 'AMC_BASIC',
      name: 'AMC Basic — 2 visits/yr',
      pricePaise: r(1999),
      visitsPerYear: 2,
      repairDiscountPct: 10,
    },
    update: { pricePaise: r(1999), visitsPerYear: 2, repairDiscountPct: 10 },
  });
  await prisma.aMCPlan.upsert({
    where: { code: 'AMC_PLUS' },
    create: {
      code: 'AMC_PLUS',
      name: 'AMC Plus — 4 visits/yr',
      pricePaise: r(3999),
      visitsPerYear: 4,
      repairDiscountPct: 20,
      zeroEmergencyFee: true,
      prioritySosQueue: true,
      surgeCapX100: 125,
    },
    update: {
      pricePaise: r(3999),
      visitsPerYear: 4,
      repairDiscountPct: 20,
      zeroEmergencyFee: true,
      prioritySosQueue: true,
      surgeCapX100: 125,
    },
  });
  console.log('  AMC plans: 2');
}

async function seedPriceRules(): Promise<void> {
  // Versioned + effective-dated. Params here mirror BUILD-PROMPT "PRICING ENGINE".
  const effectiveFrom = new Date('2026-01-01T00:00:00Z');
  const rules = [
    { type: 'NIGHT' as const, params: { multiplierX100: 150, startHourIst: 22, endHourIst: 6 } },
    {
      type: 'HOLIDAY' as const,
      params: { multiplierX100: 125, sundays: true, holidayDatesIst: [] as string[] },
    },
    {
      type: 'EMERGENCY_FEE' as const,
      params: { E0Paise: '49900', E1Paise: '29900', e1WaiverSubtotalOverPaise: '150000' },
    },
    { type: 'SURGE' as const, params: { capX100: 200, smoothing: 'ewma-15min' } },
    {
      type: 'AMC_DISCOUNT' as const,
      params: { source: 'AMCPlan.repairDiscountPct', labourOnly: true },
    },
  ];
  for (const rule of rules) {
    const existing = await prisma.priceRule.findFirst({
      where: { type: rule.type, city: null, version: 1 },
    });
    if (existing) {
      await prisma.priceRule.update({ where: { id: existing.id }, data: { params: rule.params } });
    } else {
      await prisma.priceRule.create({
        data: { type: rule.type, city: null, params: rule.params, effectiveFrom, version: 1 },
      });
    }
  }
  console.log(
    `  price rules: ${rules.length} (v1, effective ${effectiveFrom.toISOString().slice(0, 10)})`,
  );
}

async function seedSafetyScripts(): Promise<void> {
  for (const s of SAFETY_SCRIPTS) {
    const body = [
      '> **PENDING_EXPERT_REVIEW** — draft only. A licensed plumber and a safety',
      '> consultant must author/approve this copy. Scripts without `reviewedAt`',
      '> are never served in production (hard flag).',
      '',
      s.draft,
    ].join('\n');
    await prisma.safetyScript.upsert({
      where: { issueType_version: { issueType: s.issueType, version: 1 } },
      create: { issueType: s.issueType, version: 1, bodyMarkdown: body, illustrationKeys: [] },
      update: { bodyMarkdown: body },
    });
  }
  console.log(`  safety scripts: ${SAFETY_SCRIPTS.length} (v1, PENDING_EXPERT_REVIEW)`);
}

async function seedTestUsers(): Promise<void> {
  const users = [
    {
      phone: '+919812345001',
      name: 'Asha Nair',
      addr: {
        label: 'Home',
        line1: '221, 5th Block',
        line2: 'Koramangala',
        pincode: '560095',
        city: 'Bengaluru',
        lng: 77.622,
        lat: 12.934,
      },
    },
    {
      phone: '+919812345002',
      name: 'Rahul Mehta',
      addr: {
        label: 'Home',
        line1: '14, 100 Feet Road',
        line2: 'Indiranagar',
        pincode: '560038',
        city: 'Bengaluru',
        lng: 77.641,
        lat: 12.978,
      },
    },
  ];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      create: { phone: u.phone, name: u.name },
      update: { name: u.name },
    });
    let address = await prisma.address.findFirst({
      where: { userId: user.id, label: u.addr.label },
    });
    if (!address) {
      address = await prisma.address.create({
        data: {
          userId: user.id,
          label: u.addr.label,
          line1: u.addr.line1,
          line2: u.addr.line2,
          pincode: u.addr.pincode,
          city: u.addr.city,
          isDefault: true,
        },
      });
    }
    const point = `POINT(${u.addr.lng} ${u.addr.lat})`;
    await prisma.$executeRaw`UPDATE "Address" SET location = ST_GeogFromText(${point}) WHERE id = ${address.id}`;
  }
  console.log(`  test users: ${users.length} (addresses geocoded)`);
}

async function seedCoupons(): Promise<void> {
  await prisma.coupon.upsert({
    where: { code: 'WELCOME100' },
    create: {
      code: 'WELCOME100',
      kind: 'FLAT',
      flatPaise: r(100),
      validFrom: new Date('2026-01-01T00:00:00Z'),
    },
    update: {},
  });
  console.log('  coupons: 1');
}

async function main(): Promise<void> {
  console.log('Seeding PipeFix reference data…');
  await seedCatalog();
  const zones = await seedZones();
  await seedPartners(zones);
  await seedAmcPlans();
  await seedPriceRules();
  await seedSafetyScripts();
  await seedTestUsers();
  await seedCoupons();
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
