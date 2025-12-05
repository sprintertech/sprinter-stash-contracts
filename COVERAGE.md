# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works: Dual Validation

Developers run coverage locally and commit the baseline file. CI validates both that the developer ran coverage correctly AND that coverage didn't decrease.

### Coverage Workflow (`.github/workflows/coverage.yml`)
**Triggers:** Every pull request to main

**What it does:**
1. **Fetches baseline from main branch** - the current production baseline
2. **Reads baseline from PR branch** - the baseline you committed
3. **Runs coverage fresh in CI** - generates actual coverage from your code
4. **Performs two validations:**

   **Validation 1: Did you run coverage locally?**
   - ✅ **PASS** if `CI coverage === PR baseline` (you ran coverage correctly)
   - ❌ **FAIL** if `CI coverage !== PR baseline` (you forgot to run coverage or tampered with file)

   **Validation 2: Did coverage decrease?**
   - ✅ **PASS** if `CI coverage >= main baseline` (coverage maintained or improved)
   - ❌ **FAIL** if `CI coverage < main baseline` (coverage decreased)

**Security Model:**
- ✅ **Can't skip running coverage** - CI checks if your committed baseline matches actual coverage
- ✅ **Can't decrease coverage** - CI checks if your coverage is below main's baseline
- ✅ **Can't cheat** - CI regenerates coverage fresh and validates against both baselines
- ✅ **Visible in PR** - Baseline changes are visible in the PR diff

---

**Effect:** Coverage can only go up or stay the same, never down! This creates a "ratchet effect" where quality continuously improves. ✅

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

**IMPORTANT:** You must run coverage locally and commit the baseline file with your PR.

**Step-by-step:**
1. Make your code changes
2. Run coverage locally:
   ```bash
   npm run coverage
   ```
3. Update the baseline file:
   ```bash
   npm run coverage:update-baseline
   ```
4. Commit the baseline file:
   ```bash
   git add coverage-baseline.json
   git commit -m "chore: update coverage baseline"
   ```
5. Push your PR

**What CI validates:**
- ✅ **Check 1:** Your committed baseline matches CI coverage (proves you ran coverage)
- ✅ **Check 2:** Your coverage is >= main's baseline (proves coverage didn't drop)

**If CI fails:**
- **"CI coverage doesn't match PR baseline"** → You forgot step 2-4 above. Run them and push.
- **"Coverage decreased"** → Add more tests to improve coverage.

### For Maintainers

**No special maintenance needed!** Developers commit their own baseline files.

The workflow only validates - it doesn't modify anything. When a PR merges, the updated baseline goes to main automatically.

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
