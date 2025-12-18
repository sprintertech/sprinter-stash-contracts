# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works: Dual Validation

Developers run coverage locally and commit the baseline file. CI validates both that the developer ran coverage correctly AND that coverage didn't decrease beyond tolerance.

### Coverage Workflow (`.github/workflows/coverage.yml`)
**Triggers:** Every pull request to main

**What it does:**
1. **Fetches baseline from main branch** - the current production baseline (coverage-baseline-main.json)
2. **Reads baseline from PR branch** - the baseline you committed (coverage-baseline.json)
3. **Runs coverage fresh in CI** - generates actual coverage from your code (coverage/lcov.info)
4. **Displays all three values** - Shows CI actual, PR baseline, and Main baseline side-by-side
5. **Performs two validations with ±0.2% tolerance:**

   **Validation 1: Did you run coverage locally?**
   - ✅ **PASS** if `CI coverage ≈ PR baseline (±0.2%)` (you ran coverage correctly)
   - ❌ **FAIL** if difference exceeds tolerance (you forgot to run coverage or tampered with file)

   **Validation 2: Did coverage decrease?**
   - ✅ **PASS** if `CI coverage >= main baseline - 0.2%` (coverage maintained within tolerance)
   - ❌ **FAIL** if `CI coverage < main baseline - 0.2%` (coverage decreased beyond tolerance)

**Tolerance:**
A ±0.2% tolerance is applied to both checks to account for:
- Minor variations in test execution
- Rounding differences in coverage calculation
- Small changes in external contract states (tests fork at latest block)

**Security Model:**
- ✅ **Can't skip running coverage** - CI checks if your committed baseline matches actual coverage (within tolerance)
- ✅ **Can't decrease coverage** - CI checks if your coverage is below main's baseline (beyond tolerance)
- ✅ **Can't cheat** - CI regenerates coverage fresh and validates against both baselines
- ✅ **Can't commit invalid baseline** - CI validates JSON format before processing
- ✅ **Can't skip baseline file** - CI fails immediately if baseline file is missing
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
2. Ensure `.env` file exists (copy from `.env.example` if needed):
   ```bash
   cp .env.example .env
   ```
3. Run coverage locally:
   ```bash
   npm run coverage
   ```
4. Update the baseline file:
   ```bash
   npm run coverage:update-baseline
   ```
5. Commit the baseline file:
   ```bash
   git add coverage-baseline.json
   git commit -m "chore: update coverage baseline"
   ```
6. Push your PR

**What CI validates:**
- ✅ **Check 1:** Your committed baseline matches CI coverage within ±0.2% (proves you ran coverage)
- ✅ **Check 2:** Your coverage is >= main's baseline - 0.2% (proves coverage didn't drop beyond tolerance)

**If CI fails:**
- **"No coverage-baseline.json found in PR"** → You forgot to commit the baseline file. Run steps 3-5 above and push.
- **"coverage-baseline.json is not valid JSON"** → The baseline file is corrupted. Run `npm run coverage:update-baseline` and commit.
- **"Coverage decreased beyond tolerance"** → Coverage dropped more than 0.2% compared to PR baseline or main baseline. Add more tests to maintain or improve coverage.

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
- CI fetches main branch baseline as `coverage-baseline-main.json`
- Scripts:
  - `scripts/check-coverage.ts` - Validates coverage against both PR and main baselines with ±0.2% tolerance
  - Accepts `--main-baseline=<path>` parameter to compare against main branch baseline

### Environment Setup
The workflow copies `.env.example` to `.env` to enable fork tests with public RPC endpoints during coverage runs. Tests fork at the latest block to ensure they work with current mainnet state.

### Branch Protection
To enforce coverage checks, enable branch protection on main:
1. GitHub Settings → Branches → Branch protection rules
2. Add rule for `main` branch
3. Enable "Require status checks to pass before merging"
4. Select "coverage" as required check
