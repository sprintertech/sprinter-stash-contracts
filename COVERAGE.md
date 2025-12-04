# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works: Two-Phase Automated Protection

This system uses two GitHub Actions workflows that work together to enforce coverage without manual maintenance:

### Phase 1: PR Check (`.github/workflows/coverage.yml`)
**Triggers:** Every pull request to main

**What it does:**
1. Fetches `coverage-baseline.json` from **main branch** (not PR branch)
2. Runs `npm run coverage` on PR code to generate fresh coverage
3. Compares PR coverage against main's baseline
4. **Result:**
   - ❌ Blocks merge if coverage drops below baseline
   - ✅ Passes if coverage maintained or improved
   - Shows detailed comparison in CI output

**Security:** Developers cannot cheat by modifying the baseline file in their PR because CI always fetches the baseline from the main branch.

### Phase 2: Auto-Update (`.github/workflows/update-baseline.yml`)
**Triggers:** Every push to main (after PR merge)

**What it does:**
1. Runs `npm run coverage` on the new main branch code
2. Updates `coverage-baseline.json` with the new coverage values
3. Commits the updated baseline automatically (only if coverage changed)
4. Uses `github-actions[bot]` for the commit

**Result:** The baseline automatically tracks the current coverage on main, requiring zero manual maintenance.

---

**Combined Effect:** Coverage can only go up or stay the same, never down! This creates a "ratchet effect" where quality continuously improves. ✅

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

## Technical Details

### Coverage Calculation
- Uses Hardhat's built-in coverage tool (generates `coverage/lcov.info`)
- Parses LCOV format to extract: lines, functions, branches, statements
- Stores baseline in `coverage-baseline.json` at repository root
- Script: `scripts/check-coverage.ts`

### Environment Setup for CI
Both workflows copy `.env.example` to `.env` to enable fork tests with public RPC endpoints during coverage runs.

### Branch Protection
To enforce coverage checks, enable branch protection on main:
1. GitHub Settings → Branches → Branch protection rules
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select "coverage" as required check
