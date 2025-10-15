/* /Farm-vista/js/menu.js
   FarmVista navigation config (DATA ONLY).
   The shell will import this and render the drawer.
   No fallbacks — if import fails, shell should show a toast (not a fake menu).
*/

/**
 * @typedef {'link'|'group'} NavItemType
 * @typedef {'starts-with'|'exact'|'regex'} ActiveMatch
 *
 * @typedef NavItem
 * @property {NavItemType} type
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {string} [href]
 * @property {boolean} [external=false]
 * @property {ActiveMatch} [activeMatch='starts-with']
 * @property {boolean} [collapsible=false]
 * @property {boolean} [initialOpen=false]
 * @property {NavItem[]} [children]
 * @property {string[]} [roles]
 */

/**
 * @typedef NavConfig
 * @property {{name:string, location?:string, logo?:string}} org
 * @property {{brand:string, slogan?:string}} footer
 * @property {NavItem[]} items
 * @property {{stateKey?: string}} [options]   // localStorage key for group open/close state
 */

/** @type {NavConfig} */
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
    {
      type: 'link',
      id: 'home',
      icon: '🏠',
      label: 'Home',
      href: '/Farm-vista/dashboard/',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '#',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '#',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '#',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: '#',
      activeMatch: 'starts-with'
    },
    {
      type: 'link',
      id: 'reports',
      icon: '📊',
      label: 'Reports',
      href: '#',
      activeMatch: 'starts-with'
    },

    // Collapsible Setup group — label navigates, arrow toggles children
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: '/Farm-vista/settings-setup/setup.html', // clicking label goes to Setup Dashboard
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'setup-message-board',
          icon: '📢',
          label: 'Message Board',
          href: '/Farm-vista/settings-setup/ss-message-board.html',
          activeMatch: 'exact'
        }
        // Add more setup children here as you build them.
      ]
      // roles: ['admin'], // (optional) enable later for role-based visibility
    }
  ],

  options: {
    // Where the shell should store open/closed state for groups
    stateKey: 'fv:nav:groups'
  }
};

export default NAV_MENU;