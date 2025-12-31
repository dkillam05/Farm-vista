/* /Farm-vista/js/menu.js — FarmVista navigation config (ROOT-ABSOLUTE HREFs)
   All hrefs begin with /Farm-vista/ so links work from ANY page depth.

   Permissions:
   - Each item may declare `perm: 'feature-key'`.
   - If `perm` is omitted, the item is always visible.
   - Later, nav UI will filter items with `FV.can(item.perm)`.
*/

export const NAV_MENU = {
  org: {
    name: 'Dowson Farms',
    location: 'Divernon, Illinois',
    logo: '/Farm-vista/assets/icons/icon-192.png'
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
      href: '/Farm-vista/index.html',
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      perm: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '/Farm-vista/pages/crop-production/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'crop-weather',
          perm: 'crop-weather',
          icon: '⛅',
          label: 'Field Readiness',
          href: '/Farm-vista/pages/crop-production/field-weather.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'crop-maint',
          perm: 'crop-maint',
          icon: '🛠️',
          label: 'Field Maintenance',
          href: '/Farm-vista/pages/crop-production/maintenance.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'crop-trials',
          perm: 'crop-trials',
          icon: '🧬',
          label: 'Trials',
          href: '/Farm-vista/pages/crop-production/trials.html',
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
              label: 'Crop Planning Selector',
              href: '/Farm-vista/pages/crop-production/planning/indec.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-planting',
              perm: 'crop-planting',
              icon: '🌱',
              label: 'Planting',
              href: '/Farm-vista/pages/crop-production/planting.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-spraying',
              perm: 'crop-spraying',
              icon: '💦',
              label: 'Spraying',
              href: '/Farm-vista/pages/crop-production/spraying.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-aerial',
              perm: 'crop-aerial',
              icon: '🚁',
              label: 'Aerial Applications',
              href: '/Farm-vista/pages/crop-production/aerial.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-fertilizer',
              perm: 'crop-fertilizer',
              icon: '🧂',
              label: 'Fertilizer',
              href: '/Farm-vista/pages/crop-production/fertilizer.html',
              activeMatch: 'exact'
            },
            {
              type: 'link',
              id: 'crop-harvest',
              perm: 'crop-harvest',
              icon: '🌾',
              label: 'Harvest',
              href: '/Farm-vista/pages/crop-production/harvest.html',
              activeMatch: 'exact'
            }
          ]
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
      href: '/Farm-vista/pages/grain/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'grain-bins',
          perm: 'grain-bins',
          icon: '🛢️',
          label: 'Grain Bin Inventory',
          href: '/Farm-vista/pages/grain/grain-bins.html'
        },
        {
          type: 'link',
          id: 'grain-bags',
          perm: 'grain-bags',
          icon: '👝',
          label: 'Grain Bag Inventory',
          href: '/Farm-vista/pages/grain/grain-bags.html'
        },
        {
          type: 'link',
          id: 'grain-tix',
          perm: 'grain-tix',
          icon: '🎟️',
          label: 'Grain Tickets (OCR)',
          href: '/Farm-vista/pages/grain/grain-ticket-ocr.html'
        },
        {
          type: 'link',
          id: 'grain-ctr',
          perm: 'grain-ctr',
          icon: '📄',
          label: 'Grain Contracts',
          href: '/Farm-vista/pages/grain/grain-contracts.html'
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
      href: '/Farm-vista/pages/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'eq-maint-workorders',
          perm: 'eq-maint-workorders',
          icon: '🧰',
          label: 'Maintenance Work Orders',
          href: '/Farm-vista/pages/equipment/maintenance-index.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'eq-maint-records',
          perm: 'eq-maint-records',
          icon: '📚',
          label: 'Maintenance Records',
          href: '/Farm-vista/pages/equipment/maintenance-records.html',
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
            { type: 'link', id: 'eq-tractors', perm: 'eq-tractors', icon: '🚜', label: 'Tractors', href: '/Farm-vista/pages/equipment/equipment-tractors.html' },
            { type: 'link', id: 'eq-combines', perm: 'eq-combines', icon: '🌾', label: 'Combines', href: '/Farm-vista/pages/equipment/equipment-combines.html' },
            { type: 'link', id: 'eq-implements', perm: 'eq-implements', icon: '⚙️', label: 'Implements', href: '/Farm-vista/pages/equipment/equipment-implements.html' },
            { type: 'link', id: 'eq-sprayers', perm: 'eq-sprayers', icon: '💦', label: 'Sprayers', href: '/Farm-vista/pages/equipment/equipment-sprayers.html' },
            { type: 'link', id: 'eq-fertilizer', perm: 'eq-fertilizer', icon: '🧂', label: 'Fertilizer Equipment', href: '/Farm-vista/pages/equipment/equipment-fertilizer.html' },
            { type: 'link', id: 'eq-construction', perm: 'eq-construction', icon: '🏗️', label: 'Construction', href: '/Farm-vista/pages/equipment/equipment-construction.html' },
            { type: 'link', id: 'eq-trucks', perm: 'eq-trucks', icon: '🚚', label: 'Trucks', href: '/Farm-vista/pages/equipment/equipment-trucks.html' },
            { type: 'link', id: 'eq-trailers', perm: 'eq-trailers', icon: '🚛', label: 'Trailers', href: '/Farm-vista/pages/equipment/equipment-trailers.html' },
            { type: 'link', id: 'eq-starfire', perm: 'eq-starfire', icon: '🛰️', label: 'StarFire / Technology', href: '/Farm-vista/pages/equipment/equipment-starfire.html' }
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
          type: 'link',
          id: 'office-field-boundary-correction',
          perm: 'office-field-boundary-correction',
          icon: '🗺️',
          label: 'Field Boundary Correction',
          href: '/Farm-vista/pages/office/field-boundaries.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'office-vehicle-registration',
          perm: 'office-vehicle-registration',
          icon: '🚗',
          label: 'Vehicle Registration',
          href: '/Farm-vista/pages/office/vehicle-registration.html',
          activeMatch: 'exact'
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
            { type: 'link', id: 'teams-employees', perm: 'teams-employees', icon: '👤', label: 'Employees', href: '/Farm-vista/pages/office/teams-and-partners/employees.html' },
            { type: 'link', id: 'teams-sub-contractors', perm: 'teams-sub-contractors', icon: '🧰', label: 'Sub-Contractors', href: '/Farm-vista/pages/office/teams-and-partners/sub_contractors.html' },
            { type: 'link', id: 'teams-vendors', perm: 'teams-vendors', icon: '🏪', label: 'Vendors', href: '/Farm-vista/pages/office/teams-and-partners/vendors.html' },
            { type: 'link', id: 'teams-dictionary', perm: 'teams-dictionary', icon: '📖', label: 'Dictionary', href: '/Farm-vista/pages/office/teams-and-partners/dictionary.html' }
          ]
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
          href: '/Farm-vista/pages/inventory/grain-bags.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'inv-manual-removal',
          perm: 'inv-manual-removal',
          icon: '➖',
          label: 'Inventory Manual Adjustment',
          href: '/Farm-vista/pages/inventory/manual-removal.html',
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
          href: '/Farm-vista/pages/expenses/expenditures.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'exp-reports',
          perm: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: '/Farm-vista/pages/expenses/reports/index.html',
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
        { type: 'link', id: 'calc-area', perm: 'calc-area', icon: '📐', label: 'Area', href: '/Farm-vista/pages/calculators/calc-area.html' },
        { type: 'link', id: 'calc-bin', perm: 'calc-bin', icon: '🛢️', label: 'Grain Bin', href: '/Farm-vista/pages/calculators/calc-grain-bin.html' },
        { type: 'link', id: 'calc-shrink', perm: 'calc-shrink', icon: '📉', label: 'Grain Shrink', href: '/Farm-vista/pages/calculators/calc-grain-shrink.html' },
        { type: 'link', id: 'calc-combine-loss', perm: 'calc-combine-loss', icon: '🌾', label: 'Combine Grain Loss', href: '/Farm-vista/pages/calculators/calc-combine-grain-loss.html' },
        { type: 'link', id: 'calc-combine-yld', perm: 'calc-combine-yld', icon: '✅', label: 'Combine Yield Check', href: '/Farm-vista/pages/calculators/calc-combine-yield.html' },
        { type: 'link', id: 'calc-combine-calibration', perm: 'calc-combine-calibration', icon: '⚖️', label: 'Combine Yield Calibration', href: '/Farm-vista/pages/calculators/calc-combine-yield-calibration.html', activeMatch: 'exact' },
        { type: 'link', id: 'calc-chem-mix', perm: 'calc-chem-mix', icon: '🧪', label: 'Chemical Mix', href: '/Farm-vista/pages/calculators/calc-chemical-mix.html' },
        { type: 'link', id: 'calc-trial-ylds', perm: 'calc-trial-ylds', icon: '🧬', label: 'Trial Yields', href: '/Farm-vista/pages/calculators/calc-trial-yields.html' }
      ]
    },

    /* ===== Reports ===== */
    {
      type: 'group',
      id: 'reports',
      perm: 'reports',
      icon: '📑',
      label: 'Reports',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'reports-predef',
          perm: 'reports-predef',
          icon: '📚',
          label: 'Predefined Reports',
          href: '/Farm-vista/pages/reports/reports-predefined.html',
          activeMatch: 'starts-with'
        }
      ]
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
            { type: 'link', id: 'setup-prod-seed', perm: 'setup-prod-seed', icon: '🌱', label: 'Seed', href: '/Farm-vista/pages/setup/products/seed.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical', perm: 'setup-prod-chemical', icon: '🧪', label: 'Chemical', href: '/Farm-vista/pages/setup/products/chemical.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', perm: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer', href: '/Farm-vista/pages/setup/products/fertilizer.html', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags', perm: 'setup-prod-grainbags', icon: '👝', label: 'Grain Bags', href: '/Farm-vista/pages/setup/products/grain-bags.html', activeMatch: 'starts-with' }
          ]
        },
        {
          type: 'link',
          id: 'setup-import-templates',
          perm: 'setup-import-templates',
          icon: '📥',
          label: 'Import Templates',
          href: '/Farm-vista/pages/setup/import-templates.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-message-board',
          perm: 'setup-message-board',
          icon: '📢',
          label: 'Message Board',
          href: '/Farm-vista/pages/setup/message-board.html',
          activeMatch: 'exact'
        },
        {
          type: 'link',
          id: 'setup-farms',
          perm: 'setup-farms',
          icon: '🏷️',
          label: 'Farms',
          href: '/Farm-vista/pages/setup/farms.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-fields',
          perm: 'setup-fields',
          icon: '🗺️',
          label: 'Fields',
          href: '/Farm-vista/pages/setup/fields.html',
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
          href: '/Farm-vista/pages/setup/grain-bin-sites.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-rtk-towers',
          perm: 'setup-rtk-towers',
          icon: '🛰️',
          label: 'RTK Tower Information',
          href: '/Farm-vista/pages/setup/rtk-tower-information.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-company',
          perm: 'setup-company',
          label: 'Company Details',
          icon: '🏢',
          href: '/Farm-vista/pages/setup/company-details.html',
          activeMatch: 'starts-with'
        },
        {
          type: 'link',
          id: 'setup-roles',
          perm: 'setup-roles',
          label: 'Account Roles',
          icon: '👥',
          href: '/Farm-vista/pages/setup/account-roles.html',
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
