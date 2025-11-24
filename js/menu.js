/* /Farm-vista/js/menu.js — FarmVista navigation config (ROOT-ABSOLUTE HREFs)
   All hrefs begin with /Farm-vista/ so links work from ANY page depth.
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
      icon: '🏠',
      label: 'Home',
      href: '/Farm-vista/index.html',
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '/Farm-vista/pages/crop-production/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        // Field Maintenance at the top
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',  href: '/Farm-vista/pages/crop-production/maintenance.html', activeMatch: 'exact' },
        // Trials under that
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',              href: '/Farm-vista/pages/crop-production/trials.html',      activeMatch: 'exact' },
        // Rest in desired order
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',            href: '/Farm-vista/pages/crop-production/planting.html',    activeMatch: 'exact' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',            href: '/Farm-vista/pages/crop-production/spraying.html',    activeMatch: 'exact' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications', href: '/Farm-vista/pages/crop-production/aerial.html',      activeMatch: 'exact' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',          href: '/Farm-vista/pages/crop-production/fertilizer.html',  activeMatch: 'exact' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',             href: '/Farm-vista/pages/crop-production/harvest.html',     activeMatch: 'exact' }
      ]
    },

    /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '/Farm-vista/pages/grain/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bins',  icon: '🛢️', label: 'Grain Bin Inventory',  href: '/Farm-vista/pages/grain/grain-bins.html' },
        { type: 'link', id: 'grain-bags',  icon: '👝',  label: 'Grain Bag Inventory',  href: '/Farm-vista/pages/grain/grain-bags.html' },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets (OCR)',  href: '/Farm-vista/pages/grain/grain-ticket-ocr.html' },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: '/Farm-vista/pages/grain/grain-contracts.html' }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '/Farm-vista/pages/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',     icon: '🚜', label: 'Tractors',               href: '/Farm-vista/pages/equipment/equipment-tractors.html' },
        { type: 'link', id: 'eq-combines',     icon: '🌾', label: 'Combines',               href: '/Farm-vista/pages/equipment/equipment-combines.html' },
        { type: 'link', id: 'eq-implements',   icon: '⚙️', label: 'Implements',             href: '/Farm-vista/pages/equipment/equipment-implements.html' },
        { type: 'link', id: 'eq-sprayers',     icon: '💦', label: 'Sprayers',               href: '/Farm-vista/pages/equipment/equipment-sprayers.html' },
        { type: 'link', id: 'eq-fertilizer',   icon: '🧂', label: 'Fertilizer Equipment',   href: '/Farm-vista/pages/equipment/equipment-fertilizer.html' },
        { type: 'link', id: 'eq-construction', icon: '🏗️', label: 'Construction',          href: '/Farm-vista/pages/equipment/equipment-construction.html' },
        { type: 'link', id: 'eq-trucks',       icon: '🚚', label: 'Trucks',                  href: '/Farm-vista/pages/equipment/equipment-trucks.html' },
        { type: 'link', id: 'eq-trailers',     icon: '🚛', label: 'Trailers',                href: '/Farm-vista/pages/equipment/equipment-trailers.html' },
        { type: 'link', id: 'eq-starfire',     icon: '🛰️', label: 'StarFire / Technology',  href: '/Farm-vista/pages/equipment/equipment-starfire.html' }
      ]
    },

    /* ===== Office ===== */
    {
      type: 'group',
      id: 'office',
      icon: '🏢',
      label: 'Office',
      href: '/Farm-vista/pages/office/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'office-teams',
          icon: '👥',
          label: 'Teams & Partners',
          href: '/Farm-vista/pages/office/teams-and-partners/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'teams-employees',       icon: '👤',     label: 'Employees',        href: '/Farm-vista/pages/office/teams-and-partners/employees.html' },
            { type: 'link', id: 'teams-sub-contractors', icon: '🧰',     label: 'Sub-Contractors',  href: '/Farm-vista/pages/office/teams-and-partners/sub-contractors.html' },
            { type: 'link', id: 'teams-vendors',         icon: '🏪',     label: 'Vendors',          href: '/Farm-vista/pages/office/teams-and-partners/vendors.html' },
            { type: 'link', id: 'teams-dictionary',      icon: '📖',     label: 'Dictionary',       href: '/Farm-vista/pages/office/teams-and-partners/dictionary.html' }
          ]
        },

        { type: 'link', id: 'office-vehicle-registration', icon: '🚗', label: 'Vehicle Registration', href: '/Farm-vista/pages/office/vehicle-registration.html', activeMatch: 'exact' },
        { type: 'link', id: 'office-field-boundaries',     icon: '🗺️', label: 'Field Boundaries',      href: '/Farm-vista/pages/office/field-boundaries.html',     activeMatch: 'starts-with' }
      ]
    },

    /* ===== Inventory ===== */
    {
      type: 'group',
      id: 'inventory',
      icon: '📦',
      label: 'Inventory',
      href: '/Farm-vista/pages/inventory/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'inv-grain-bags', icon: '👝', label: 'Grain Bag Inventory', href: '/Farm-vista/pages/inventory/grain-bags.html', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Expenses ===== */
    {
      type: 'group',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: '/Farm-vista/pages/expenses/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'exp-expenditures', icon: '🧾', label: 'Expenditures', href: '/Farm-vista/pages/expenses/expenditures.html', activeMatch: 'starts-with' },
        {
          type: 'group',
          id: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: '/Farm-vista/pages/expenses/reports/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'exp-reports-custom',  icon: '🛠️', label: 'Customized Reports', href: '/Farm-vista/pages/expenses/reports/custom.html',     activeMatch: 'starts-with' },
            { type: 'link', id: 'exp-reports-predef',  icon: '📚', label: 'Predefined Reports', href: '/Farm-vista/pages/expenses/reports/predefined.html', activeMatch: 'starts-with' }
          ]
        }
      ]
    },

    /* ===== Calculators ===== */
    {
      type: 'group',
      id: 'calculators',
      icon: '🔢',
      label: 'Calculators',
      href: '/Farm-vista/pages/calculators/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area',         icon: '📐', label: 'Area',                         href: '/Farm-vista/pages/calculators/calc-area.html' },
        { type: 'link', id: 'calc-bin',          icon: '🛢️', label: 'Grain Bin',                    href: '/Farm-vista/pages/calculators/calc-grain-bin.html' },
        { type: 'link', id: 'calc-shrink',       icon: '📉', label: 'Grain Shrink',                 href: '/Farm-vista/pages/calculators/calc-grain-shrink.html' },
        { type: 'link', id: 'calc-combine-loss', icon: '🌾', label: 'Combine Grain Loss',           href: '/Farm-vista/pages/calculators/calc-combine-grain-loss.html' },
        { type: 'link', id: 'calc-combine-yld',  icon: '✅', label: 'Combine Yield Check',           href: '/Farm-vista/pages/calculators/calc-combine-yield.html' },
        { type: 'link', id: 'calc-combine-calibration', icon: '⚖️', label: 'Combine Yield Calibration', href: '/Farm-vista/pages/calculators/calc-combine-yield-calibration.html', activeMatch: 'exact' },
        { type: 'link', id: 'calc-chem-mix',     icon: '🧪', label: 'Chemical Mix',                 href: '/Farm-vista/pages/calculators/calc-chemical-mix.html' },
        { type: 'link', id: 'calc-trial-ylds',   icon: '🧬', label: 'Trial Yields',                 href: '/Farm-vista/pages/calculators/calc-trial-yields.html' }
      ]
    },

    /* ===== Reports ===== */
    {
      type: 'group',
      id: 'reports',
      icon: '📑',
      label: 'Reports',
      href: '/Farm-vista/pages/reports/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        //{ type: 'link', id: 'reports-custom',  icon: '🛠️', label: 'AI Reports (Custom)', href: '/Farm-vista/pages/reports/reports-ai.html' },
        { type: 'link', id: 'reports-predef',  icon: '📚', label: 'Predefined Reports',  href: '/Farm-vista/pages/reports/reports-predefined.html' },
        //{ type: 'link', id: 'reports-history', icon: '🗂️', label: 'AI Report History',   href: '/Farm-vista/pages/reports/reports-ai-history.html' }
      ]
    },

    /* ===== Setup ===== */
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: '/Farm-vista/pages/setup/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          href: '/Farm-vista/pages/setup/products/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed',       icon: '🌱', label: 'Seed',        href: '/Farm-vista/pages/setup/products/seed.html',        activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical',   icon: '🧪', label: 'Chemical',    href: '/Farm-vista/pages/setup/products/chemical.html',    activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer',  href: '/Farm-vista/pages/setup/products/fertilizer.html',  activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags',  href: '/Farm-vista/pages/setup/products/grain-bags.html',  activeMatch: 'starts-with' }
          ]
        },

        /* NEW: Import Templates, directly under Products */
        { type: 'link', id: 'setup-import-templates', icon: '📥', label: 'Import Templates', href: '/Farm-vista/pages/setup/import-templates.html', activeMatch: 'starts-with' },

        { type: 'link', id: 'setup-message-board', icon: '📢', label: 'Message Board', href: '/Farm-vista/pages/setup/message-board.html', activeMatch: 'exact' },

        { type: 'link', id: 'setup-farms',   icon: '🏷️', label: 'Farms',  href: '/Farm-vista/pages/setup/farms.html',  activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields',  icon: '🗺️', label: 'Fields', href: '/Farm-vista/pages/setup/fields.html', activeMatch: 'starts-with' },

        {
          type: 'link',
          id: 'setup-grain-sites',
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

        { type: 'link', id: 'setup-rtk-towers', icon: '🛰️', label: 'RTK Tower Information', href: '/Farm-vista/pages/setup/rtk-tower-information.html', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-company', label: 'Company Details', icon: '🏢', href: '/Farm-vista/pages/setup/company-details.html', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   label: 'Account Roles',   icon: '👥', href: '/Farm-vista/pages/setup/account-roles.html',   activeMatch: 'starts-with' }
      ]
    }
  ],

  options: { stateKey: 'fv:nav:groups' }
};

export default NAV_MENU;
