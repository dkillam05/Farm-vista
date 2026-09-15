# Path Migration Rules

When a source file is moved from `/js/foo.js` to a nested feature folder:

1. Preserve its JavaScript contents unless a relative import inside the file must change because of the move.
2. Change every consumer in the same migration phase.
3. Preserve query-string cache-busting values unless there is a specific reason to update them.
4. Absolute `/js/...` references should remain absolute with the new destination path.
5. Relative module imports inside moved files must be recalculated from the new directory.
6. Service-worker/cache entries must be migrated with the source path; otherwise offline/PWA behavior can silently retain the old location.
7. Remove the old source only after all known consumers point to the new source.
8. Search by both old full path and basename before marking the move verified.
