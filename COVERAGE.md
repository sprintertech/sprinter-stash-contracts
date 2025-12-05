# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works: Automated Coverage Gate

This system uses a single GitHub Actions workflow that enforces coverage and auto-updates the baseline.

### Coverage Workflow (`.github/workflows/coverage.yml`)
**Triggers:** Every pull request to main

**What it does:**
1. **Fetches baseline from main branch** (not PR branch) - prevents tampering
2. **Runs coverage** on PR code to generate fresh `coverage/lcov.info`
3. **Compares** PR coverage against main's baseline
4. **Enforces the gate:**
   - ❌ **Blocks merge** if coverage drops below baseline
   - ✅ **Passes** if coverage maintained
   - ✅ **Auto-updates baseline** if coverage improved (commits to PR branch)
5. **When coverage improves:**
   - Updates `coverage-baseline.json` in the PR branch
   - Commits the change with `github-actions[bot]`
   - When PR merges, the updated baseline merges automatically

**Security:** Developers cannot cheat by modifying the baseline file because CI always fetches the comparison baseline from main branch for validation.

---

**Effect:** Coverage can only go up or stay the same, never down! This creates a "ratchet effect" where quality continuously improves. ✅

**Zero Maintenance:** When coverage improves, the baseline auto-updates in the PR itself - no manual work needed!

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

**No manual work needed!** The workflow automatically:
- Compares PR coverage against main's baseline
- Updates `coverage-baseline.json` in the PR if coverage improved
- Commits the updated baseline to the PR branch

The updated baseline merges to main automatically when the PR is merged.

You can manually update baseline locally if needed:
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
The workflow copies `.env.example` to `.env` to enable fork tests with public RPC endpoints during coverage runs.

### Branch Protection
To enforce coverage checks, enable branch protection on main:
1. GitHub Settings → Branches → Branch protection rules
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select "coverage" as required check
