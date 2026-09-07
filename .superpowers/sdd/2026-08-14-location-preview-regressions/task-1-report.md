# Task 1 Report — Make Location-Only Weekly Saves Complete

## Status
Done.

## RED
Command:
```bash
node app/live-auth-smoke.mjs
```
Initial failure:
```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ null
- 'Victoria Park Swimming Pool'
    at file:///Users/selesli/projects/island-training-club-app/.worktrees/location-map/app/live-auth-smoke.mjs:2207:8
```

## GREEN
After the fix:
```text
ok  delegated weekly venue submit copies location into blank map queries
ok  failed weekly venue submit preserves form state without rerendering
```

## Tests
- `node app/live-auth-smoke.mjs` ✅
- `node app/smoke.mjs` ✅

## Commit
Committed.

## Concerns
None.
