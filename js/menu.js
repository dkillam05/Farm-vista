/* /js/menu.js — FarmVista navigation config (ROOT-ABSOLUTE HREFs)
   All hrefs begin with / so links work from ANY page depth.

   Permissions:
   - Each item may declare `perm: 'feature-key'`.
   - If `perm` is omitted, the item is always visible.
   - Later, nav UI will filter items with `FV.can(item.perm)`.
*/

export const NAV_MENU = {
  org: {
    name: 'Dowson Farms',
    location: 'Divernon, Illinois',
    logo: '/assets/icons/icon-192.png'
  },

  footer: {
    brand: 'FarmVista',
    slogan: 'Farm data, simplified'
  },

  items: [
    /* ===== Home ===== */
    {
      type: 'link',
      id: 'home',
      // Home is always visible → no perm key
      icon: '🏠',
      label: 'Home',
      href: '/index.html',
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      perm: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '/pages/crop-production/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'crop-weather',
          perm: 'crop-weather',
          icon: '⛅',
          label: 'Field Readiness',
          href: '/pages/crop-production/field-weather.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'crop-maint',
          perm: 'crop-maint',
          icon: '🛠️',
          label: 'Field Maintenance',
          href: '/pages/crop-production/maintenance.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'crop-trials',
          perm: 'crop-trials',
          icon: '🧬',
          label: 'Trials',
          href: '/pages/crop-production/trials.html',
          activeMatch: 'exact'
        },
        {
          type: 'group',
          id: 'crop-operational-records',
          perm: 'crop-operational-records',
          icon: '📋',
          label: 'Operational Records',
          collapsible: true,
          initialOpen: false,
          children: [
            {
              type: 'link',
              id: 'crop-planning-selector',
              perm: 'crop-planning-selector',
              icon: '🧭',
              label: 'Crop Planning',
              href: '/pages/crop-production/planning/index.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-planting',
              perm: 'crop-planting',
              icon: '🌱',
              label: 'Planting',
              href: '/pages/crop-production/planting.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-spraying',
              perm: 'crop-spraying',
              icon: '💦',
              label: 'Spraying',
              href: '/pages/crop-production/spraying.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-aerial',
              perm: 'crop-aerial',
              icon: '🚁',
              label: 'Aerial Applications',
              href: '/pages/crop-production/aerial.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-fertilizer',
              perm: 'crop-fertilizer',
              icon: '🧂',
              label: 'Fertilizer',
              href: '/pages/crop-production/fertilizer.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-harvest',
              perm: 'crop-harvest',
              icon: '🌾',
              label: 'Harvest',
              href: '/pages/crop-production/harvest.html',
              activeMatch: 'exact'
            }
          ]
        }
      ]
    },

/* ===== Logistics ===== */
{
  type: 'group',
  id: 'logistics',
  perm: 'logistics',
  icon: '🚛',
  label: 'Logistics',

  // No href here. Clicking Logistics only opens the submenu.
  collapsible: true,
  initialOpen: false,

  children: [
    {
      type: 'link',
      id: 'logistics-pre-trip',
      perm: 'logistics-pre-trip',
      icon: '✅',
      label: 'New Pre-Trip',
      href: '/pages/logistics/pre-trip.html',
      activeMatch: 'exact'
    },
    {
      type: 'link',
      id: 'logistics-my-pre-trips',
      perm: 'logistics-pre-trip',
      icon: '📄',
      label: 'My Pre-Trips',
      href: '/pages/logistics/my-pre-trips.html',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'logistics-overview',
      perm: 'cap-logistics-overview',
      icon: '📊',
      label: 'Company Overview',
      href: '/pages/logistics/index.html',
      activeMatch: 'exact'
    }
  ]
},

        /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      perm: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '/pages/grain/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'grain-tix',
          perm: 'grain-tix',
          icon: '🎟️',
          label: 'Grain Tickets',
          href: '/pages/grain/grain-ticket.html'
        },
        {
          type: 'link',
          id: 'grain-ctr',
          perm: 'grain-ctr',
          icon: '📄',
          label: 'Grain Contracts',
          href: '/pages/grain/grain-contracts.html'
        },
        {
          type: 'link',
          id: 'grain-bins',
          perm: 'grain-bins',
          icon: '🛢️',
          label: 'Grain Bin Inventory',
          href: '/pages/grain/grain-bins.html'
        },
        {
          type: 'link',
          id: 'grain-bags',
          perm: 'grain-bags',
          icon: '👝',
          label: 'Grain Bag Inventory',
          href: '/pages/grain/grain-bags.html'
        }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      perm: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '/pages/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'eq-maint-workorders',
          perm: 'eq-maint-workorders',
          icon: '🧰',
          label: 'Maintenance Work Orders',
          href: '/pages/equipment/maintenance-index.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'eq-maint-records',
          perm: 'eq-maint-records',
          icon: '📚',
          label: 'Maintenance Records',
          href: '/pages/equipment/maintenance-records.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'group',
          id: 'eq-inventory',
          perm: 'eq-inventory',
          icon: '📦',
          label: 'Equipment Inventory',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'eq-tractors', perm: 'eq-tractors', icon: '🚜', label: 'Tractors', href: '/pages/equipment/equipment-tractors.html' },
            { type: 'link', id: 'eq-combines', perm: 'eq-combines', icon: '🌾', label: 'Combines', href: '/pages/equipment/equipment-combines.html' },
            { type: 'link', id: 'eq-implements', perm: 'eq-implements', icon: '⚙️', label: 'Implements', href: '/pages/equipment/equipment-implements.html' },
            { type: 'link', id: 'eq-sprayers', perm: 'eq-sprayers', icon: '💦', label: 'Sprayers', href: '/pages/equipment/equipment-sprayers.html' },
            { type: 'link', id: 'eq-fertilizer', perm: 'eq-fertilizer', icon: '🧂', label: 'Fertilizer Equipment', href: '/pages/equipment/equipment-fertilizer.html' },
            { type: 'link', id: 'eq-construction', perm: 'eq-construction', icon: '🏗️', label: 'Construction', href: '/pages/equipment/equipment-construction.html' },
            { type: 'link', id: 'eq-trucks', perm: 'eq-trucks', icon: '🚚', label: 'Trucks', href: '/pages/equipment/equipment-trucks.html' },
            { type: 'link', id: 'eq-trailers', perm: 'eq-trailers', icon: '🚛', label: 'Trailers', href: '/pages/equipment/equipment-trailers.html' },
            { type: 'link', id: 'eq-starfire', perm: 'eq-starfire', icon: '🛰️', label: 'StarFire / Technology', href: '/pages/equipment/equipment-starfire.html' }
          ]
        }
      ]
    },

    /* ===== Office ===== */
    {
      type: 'group',
      id: 'office',
      perm: 'office',
      icon: '🏢',
      label: 'Office',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'office-insurance',
          icon: '🛡️',
          label: 'Insurance',
          collapsible: true,
          initialOpen: false,
          children: [
            {
              type: 'link',
              id: 'insurance-vehicle',
              icon: '🚘',
              label: 'Vehicle',
              href: '/docs/cooming-soon.html',
              activeMatch: 'starts-with'
            },
            {
              type: 'link',
              id: 'insurance-crop',
              icon: '🌱',
              label: 'Crop',
              href: '/docs/cooming-soon.html',
              activeMatch: 'starts-with'
            },
            {
              type: 'link',
              id: 'insurance-health',
              icon: '🏥',
              label: 'Health',
              href: '/docs/cooming-soon.html',
              activeMatch: 'starts-with'
            },
            {
              type: 'link',
              id: 'insurance-liability',
              icon: '⚖️',
              label: 'Liability',
              href: '/docs/cooming-soon.html',
              activeMatch: 'starts-with'
            },
            {
              type: 'link',
              id: 'insurance-umbrella',
              icon: '☂️',
              label: 'Umbrella',
              href: '/docs/cooming-soon.html',
              activeMatch: 'starts-with'
            }
          ]
        },
        {
          type: 'group',
          id: 'office-purchase-inventory',
          icon: '🧾',
          label: 'Purchase Inventory',
          collapsible: true,
          initialOpen: false,
          children: [
            {
              type: 'link',
              id: 'office-purchase-inventory-seed',
              icon: '🌱',
              label: 'Seed',
              href: '/pages/office/purchase-inventory-seed.html',
              activeMatch: 'starts-with'
            }
          ]
        },
        {
          type: 'group',
          id: 'office-teams',
          perm: 'office-teams',
          icon: '👥',
          label: 'Teams & Partners',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'teams-employees', perm: 'teams-employees', icon: '👤', label: 'Employees', href: '/pages/office/teams-and-partners/employees.html' },
            { type: 'link', id: 'teams-sub-contractors', perm: 'teams-sub-contractors', icon: '🧰', label: 'Sub-Contractors', href: '/pages/office/teams-and-partners/sub_contractors.html' },
            { type: 'link', id: 'teams-vendors', perm: 'teams-vendors', icon: '🏪', label: 'Vendors', href: '/pages/office/teams-and-partners/vendors.html' },
            { type: 'link', id: 'teams-dictionary', perm: 'teams-dictionary', icon: '📖', label: 'Dictionary', href: '/pages/office/teams-and-partners/dictionary.html' }
          ]
        },
        {
          type: 'link',
          id: 'office-farm-land-leases',
          icon: '🌾',
          label: 'Farm Land Leases',
          href: '/docs/cooming-soon.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'office-field-boundary-correction',
          perm: 'office-field-boundary-correction',
          icon: '🗺️',
          label: 'Field Boundary Correction',
          href: '/pages/office/field-boundaries.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'office-fsa',
          icon: '🏛️',
          label: 'FSA',
          href: '/docs/cooming-soon.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'office-vehicle-registration',
          perm: 'office-vehicle-registration',
          icon: '🚗',
          label: 'Vehicle Registration',
          href: '/pages/office/vehicle-registration.html',
          activeMatch: 'exact'
        }
      ]
    },

    /* ===== Inventory ===== */
    {
      type: 'group',
      id: 'inventory',
      perm: 'inventory',
      icon: '📦',
      label: 'Inventory',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'inv-grain-bags',
          perm: 'inv-grain-bags',
          icon: '👝',
          label: 'Grain Bag Inventory',
          href: '/pages/inventory/grain-bags.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'inv-seed-inventory',
          icon: '🌱',
          label: 'Seed',
          href: '/docs/cooming-soon.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'inv-manual-removal',
          perm: 'inv-manual-removal',
          icon: '➖',
          label: 'Inventory Manual Adjustment',
          href: '/pages/inventory/manual-removal.html',
          activeMatch: 'starts-with'
        }
      ]
    },

    /* ===== Expenses ===== */
    {
      type: 'group',
      id: 'expenses',
      perm: 'expenses',
      icon: '💵',
      label: 'Expenses',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'exp-expenditures',
          perm: 'exp-expenditures',
          icon: '🧾',
          label: 'Expenditures',
          href: '/pages/expenses/expenditures.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'exp-reports',
          perm: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: '/pages/expenses/reports/index.html',
          activeMatch: 'starts-with'
        }
      ]
    },

    /* ===== Calculators ===== */
    {
      type: 'group',
      id: 'calculators',
      perm: 'calculators',
      icon: '🔢',
      label: 'Calculators',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area', perm: 'calc-area', icon: '📐', label: 'Area', href: '/pages/calculators/calc-area.html' },
        { type: 'link', id: 'calc-bin', perm: 'calc-bin', icon: '🛢️', label: 'Grain Bin', href: '/pages/calculators/calc-grain-bin.html' },
        { type: 'link', id: 'calc-shrink', perm: 'calc-shrink', icon: '📉', label: 'Grain Shrink', href: '/pages/calculators/calc-grain-shrink.html' },
        { type: 'link', id: 'calc-combine-loss', perm: 'calc-combine-loss', icon: '🌾', label: 'Combine Grain Loss', href: '/pages/calculators/calc-combine-grain-loss.html' },
        { type: 'link', id: 'calc-combine-yld', perm: 'calc-combine-yld', icon: '✅', label: 'Combine Yield Check', href: '/pages/calculators/calc-combine-yield.html' },
        { type: 'link', id: 'calc-combine-calibration', perm: 'calc-combine-calibration', icon: '⚖️', label: 'Combine Yield Calibration', href: '/pages/calculators/calc-combine-yield-calibration.html', activeMatch: 'exact' },
        { type: 'link', id: 'calc-chem-mix', perm: 'calc-chem-mix', icon: '🧪', label: 'Chemical Mix', href: '/pages/calculators/calc-chemical-mix.html' },
        { type: 'link', id: 'calc-trial-ylds', perm: 'calc-trial-ylds', icon: '🧬', label: 'Trial Yields', href: '/pages/calculators/calc-trial-yields.html' }
      ]
    },


/* ===== Reports ===== */
{
  type: 'link',
  id: 'reports',
  perm: 'reports',
  permKey: 'reports-predef',
  icon: '📑',
  label: 'Reports',
  href: '/pages/reports/reports-predefined.html',
  activeMatch: 'starts-with'
},

    /* ===== Setup ===== */
    {
      type: 'group',
      id: 'setup',
      perm: 'setup',
      icon: '⚙️',
      label: 'Setup',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'setup-products',
          perm: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed', perm: 'setup-prod-seed', icon: '🌱', label: 'Seed', href: '/pages/setup/products/seed.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical', perm: 'setup-prod-chemical', icon: '🧪', label: 'Chemical', href: '/pages/setup/products/chemical.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', perm: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer', href: '/pages/setup/products/fertilizer.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags', perm: 'setup-prod-grainbags', icon: '👝', label: 'Grain Bags', href: '/pages/setup/products/grain-bags.html', activeMatch: 'starts-with' }
          ]
        },
        {
          type: 'link',
          id: 'setup-import-templates',
          perm: 'setup-import-templates',
          icon: '📥',
          label: 'Import Templates',
          href: '/pages/setup/import-templates.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-message-board',
          perm: 'setup-message-board',
          icon: '📢',
          label: 'Message Board',
          href: '/pages/setup/message-board.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'setup-farms',
          perm: 'setup-farms',
          icon: '🏷️',
          label: 'Farms',
          href: '/pages/setup/farms.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-fields',
          perm: 'setup-fields',
          icon: '🗺️',
          label: 'Fields',
          href: '/pages/setup/fields.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-grain-sites',
          perm: 'setup-grain-sites',
          permKey: 'setup-grain-sites',
          label: 'Grain Bin Sites',
          icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true"
                 style="width:28px;height:28px;display:block;margin:0 auto;">
              <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                <path d="M6.5 7 L12 3.8 L17.5 7"/>
                <rect x="7" y="7" width="10" height="13" rx="1.6"/>
                <path d="M10 7v13M14 7v13" stroke-linecap="round"/>
              </g>
            </svg>
          `,
          href: '/pages/setup/grain-bin-sites.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-rtk-towers',
          perm: 'setup-rtk-towers',
          icon: '🛰️',
          label: 'RTK Tower Information',
          href: '/pages/setup/rtk-tower-information.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-company',
          perm: 'setup-company',
          label: 'Company Details',
          icon: '🏢',
          href: '/pages/setup/company-details.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-roles',
          perm: 'setup-roles',
          label: 'Account Roles',
          icon: '👥',
          href: '/pages/setup/account-roles.html',
          activeMatch: 'starts-with'
        }
      ]
    }
  ],

  options: { stateKey: 'fv:nav:groups' }
};

// ALSO expose on window so non-module shell code can still read it
try { if (typeof window !== 'undefined') window.NAV_MENU = NAV_MENU; } catch {}

export default NAV_MENU;
