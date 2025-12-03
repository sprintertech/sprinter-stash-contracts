# Coverage Gate System

This project uses automated coverage checks to prevent test coverage from decreasing.

## How It Works

1. **Baseline:** Current coverage is stored in `coverage-baseline.json`
2. **Check:** Every PR compares new coverage against baseline
3. **Block:** If coverage drops, the CI check fails and blocks merge

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

When merging code that improves coverage:
1. After merge, run `npm run coverage:update-baseline`
2. Commit the updated `coverage-baseline.json`
3. This becomes the new minimum for future PRs

## Current Coverage

Current baseline (as of initial setup):
- **Lines:** 96.03%
- **Functions:** 98.27%
- **Branches:** 86.19%
- **Statements:** 96.03%

## GitHub Actions

The `.github/workflows/coverage.yml` workflow automatically:
- Runs on every PR to main/master
- Generates coverage report
- Compares against baseline
- Fails if coverage drops

This prevents accidental coverage reduction and encourages maintaining high test quality.
