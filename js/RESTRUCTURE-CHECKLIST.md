# Major JS Restructure Checklist

This checklist is deliberately strict because the final path migration can break pages even when the JavaScript itself is unchanged.

## Inventory
- [ ] Enumerate every `.js` file in repository
- [ ] Classify every root `/js/*.js` file
- [ ] Review existing nested `/js/**` modules and keep/move intentionally
- [ ] Identify JS outside `/js` that imports or loads `/js` assets

## Consumers
- [ ] Root `index.html`
- [ ] `/pages/**` HTML
- [ ] `/scan/**` guest scanner
- [ ] reports
- [ ] dashboard
- [ ] Grain pages
- [ ] authentication/login pages
- [ ] service workers
- [ ] precache/cache manifests
- [ ] JS static imports
- [ ] JS dynamic imports
- [ ] runtime-created `<script>` elements
- [ ] hard-coded `/js/` URLs

## Migration
- [ ] Move/copy files into final locations
- [ ] Update consumers to final paths
- [ ] Update relative imports inside moved modules
- [ ] Remove old duplicate/root paths
- [ ] Remove migration-only `.gitkeep` files where real files occupy folders

## Static verification
- [ ] Search old filenames/paths repository-wide
- [ ] Search `/js/` references repository-wide
- [ ] Verify all referenced local JS targets exist
- [ ] Verify no intended module was omitted
- [ ] Compare against main for path-only/business-logic-neutral changes

## Handoff
- [ ] Mark branch ready for folder-layout review
- [ ] User reviews GitHub organization
- [ ] Runtime testing begins only after layout approval
- [ ] Main remains untouched until testing approval
