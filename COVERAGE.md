# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works

### Two-Phase Automated Protection

**Phase 1: PR Check (Prevent Drops)**
1. PR opens → CI fetches baseline from **main branch** (not PR branch)
2. Runs coverage on PR code
3. Compares: current coverage vs main's baseline
4. ❌ Blocks merge if coverage drops
5. ✅ Shows actual improvement if coverage increased

**Phase 2: Auto-Update (After Merge)**
1. PR merges to main → Auto-update workflow triggers automatically
2. Runs coverage on new main code
3. Updates `coverage-baseline.json` with new coverage
4. Commits new baseline to main automatically

**Result:** Coverage can only go up or stay the same, never down! ✅

**Security:** Developers cannot cheat by updating the baseline in their PR because CI always compares against main's baseline.

## Commands

```bash
# Run coverage
npm run coverage

# Check if coverage maintained (compares against baseline)
npm run coverage:check

# Update baseline (after improving coverage)
npm run coverage:update-baseline
```

## Workflow

### For Developers

When working on a PR:
1. Run `npm run coverage` to generate coverage report
2. Run `npm run coverage:check` to verify you maintained coverage
3. If check fails, add more tests until it passes

### For Maintainers

**No manual work needed!** Phase 2 automatically:
- Runs coverage after each merge to main
- Updates `coverage-baseline.json`
- Commits the new baseline

You can manually update baseline if needed:
```bash
npm run coverage:update-baseline
git add coverage-baseline.json
git commit -m "chore: update coverage baseline"
git push
```

## Current Coverage

Current baseline (as of initial setup):
- **Lines:** 96.03%
- **Functions:** 98.27%
- **Branches:** 86.19%
- **Statements:** 96.03%

## GitHub Actions

### Two Workflows Working Together

**1. Coverage Check (`.github/workflows/coverage.yml`)**
- Runs on: Every PR to main
- Actions:
  - Fetches baseline from main branch
  - Generates coverage report from PR code
  - Compares against main's baseline
  - ❌ Fails if coverage drops
  - ✅ Shows improvement if coverage increased

**2. Update Baseline (`.github/workflows/update-baseline.yml`)**
- Runs on: Every push to main (after PR merge)
- Actions:
  - Runs coverage on main code
  - Updates `coverage-baseline.json`
  - Commits new baseline automatically
  - Only commits if coverage changed

This fully automated system prevents coverage reduction while requiring zero manual work!
