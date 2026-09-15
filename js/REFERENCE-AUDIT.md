# Reference Audit

A move is not complete until references are checked by both path and basename.

## Patterns to audit

```text
src="/js/
src='/js/
import ... from "/js/
import ... from '/js/
import("/js/
import('/js/
/js/*.js
../js/
./js/
createElement("script")
createElement('script')
serviceWorker
caches.open
cache.add
cache.addAll
```

Also search individual basenames because some consumers use relative paths rather than `/js/` absolute paths.

## Special handling

Large HTML pages must not be partially replaced. A path edit to a large page must preserve the complete file content; truncating a file while changing one script path is unacceptable.
