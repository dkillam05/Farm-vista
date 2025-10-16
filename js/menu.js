/* /Farm-vista/js/menu.js
   FarmVista navigation config (DATA ONLY).
   The shell imports this and renders the drawer.
   No fallbacks — if import fails, shell should show a toast (not a fake menu).
*/

/** @type {import('./menu.js').NavConfig} */
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
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',              href: '/Farm-vista/pages/crop-production/crop-planting.html' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',              href: '/Farm-vista/pages/crop-production/crop-spraying.html' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',            href: '/Farm-vista/pages/crop-production/crop-fertilizer.html' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',               href: '/Farm-vista/pages/crop-production/crop-harvest.html' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications',   href: '/Farm-vista/pages/crop-production/crop-aerial.html' },
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',                href: '/Farm-vista/pages/crop-production/crop-trials.html' },
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',    href: '/Farm-vista/pages/crop-production/crop-maintenance.html' }
      ]
    },

    /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '/Farm-vista/grain-tracking/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bins',  icon: '🛢️', label: 'Grain Bin Inventory',  href: '/Farm-vista/grain-tracking/grain-bins.html' },
        { type: 'link', id: 'grain-bags',  icon: '👝',  label: 'Grain Bag Inventory',  href: '/Farm-vista/grain-tracking/grain-bags.html' },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: '/Farm-vista/grain-tracking/grain-contracts.html' },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets (OCR)',  href: '/Farm-vista/grain-tracking/grain-ticket-ocr.html' }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '/Farm-vista/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',     icon: '🚜', label: 'Tractors',               href: '/Farm-vista/equipment/equipment-tractors.html' },
        { type: 'link', id: 'eq-sprayers',     icon: '💦', label: 'Sprayers',               href: '/Farm-vista/equipment/equipment-sprayers.html' },
        { type: 'link', id: 'eq-combines',     icon: '🌾', label: 'Combines',               href: '/Farm-vista/equipment/equipment-combines.html' },
        { type: 'link', id: 'eq-implements',   icon: '⚙️', label: 'Implements',             href: '/Farm-vista/equipment/equipment-implements.html' },
        { type: 'link', id: 'eq-construction', icon: '🏗️', label: 'Construction',          href: '/Farm-vista/equipment/equipment-construction.html' },
        { type: 'link', id: 'eq-starfire',     icon: '🛰️', label: 'StarFire / Technology',  href: '/Farm-vista/equipment/equipment-starfire.html' },
        { type: 'link', id: 'eq-trucks',       icon: '🚚', label: 'Trucks',                  href: '/Farm-vista/equipment/equipment-trucks.html' },
        { type: 'link', id: 'eq-trailers',     icon: '🚛', label: 'Trailers',                href: '/Farm-vista/equipment/equipment-trailers.html' }
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
          type: 'link',
          id: 'setup-message-board',
          icon: '📢',
          label: 'Message Board',
          href: '/Farm-vista/pages/setup/message-board.html',
          activeMatch: 'exact'
        },
        { type: 'link', id: 'setup-farms',   icon: '🏷️', label: 'Farms',  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields',  icon: '🗺️', label: 'Fields', href: '#', activeMatch: 'starts-with' },
        {
          type: 'group',
          id: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          href: '#',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed',       icon: '🌱', label: 'Seed',        href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical',   icon: '🧪', label: 'Chemical',    href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer',  href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags',  href: '#', activeMatch: 'starts-with' }
          ]
        },
        { type: 'link', id: 'setup-company', icon: '🏢', label: 'Company Details', href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   icon: '👥', label: 'Account Roles',   href: '#', activeMatch: 'starts-with' }
      ]
    }
  ],

  options: {
    stateKey: 'fv:nav:groups'
  }
};

export default NAV_MENU;