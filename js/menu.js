      children: [
        // Weather at the very top
        {
          type: 'link',
          id: 'crop-weather',
          perm: 'crop-weather',
          icon: '⛅',
          label: 'Weather',
          href: '/Farm-vista/pages/crop-production/field-weather.html',
          activeMatch: 'exact'
        },

        // Field Maintenance under Weather
        {
          type: 'link',
          id: 'crop-maint',
          perm: 'crop-maint',
          icon: '🛠️',
          label: 'Field Maintenance',
          href: '/Farm-vista/pages/crop-production/maintenance.html',
          activeMatch: 'exact'
        },

        // Trials next
        {
          type: 'link',
          id: 'crop-trials',
          perm: 'crop-trials',
          icon: '🧬',
          label: 'Trials',
          href: '/Farm-vista/pages/crop-production/trials.html',
          activeMatch: 'exact'
        },

        // NEW: Field Boundary moved here (right under Trials)
        {
          type: 'link',
          id: 'crop-field-boundary-correction',
          perm: 'crop-field-boundary-correction',
          icon: '🗺️',
          label: 'Boundary Corrections',
          href: '/Farm-vista/pages/office/field-boundaries.html',
          activeMatch: 'starts-with'
        },

        // Operational Records group for core operations — EXPAND ONLY
        {
          type: 'group',
          id: 'crop-operational-records',
          perm: 'crop-operational-records',
          icon: '📋',
          label: 'Operational Records',
          // no href → expand-only
          collapsible: true,
          initialOpen: false,
          children: [
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