module.exports = {
  skipFiles: [
    // Skip test contracts
    "testing/",

    // Skip echidna/fuzzing contracts
    "echidna/",

    // Skip utility contracts that are only used for deployment
    "utils/PushNativeToken.sol",

    // Skip dependencies
    "Deps.sol",
  ],

  // Automatically include all test files (scalable approach)
  // testfiles: "./test/**/*.ts" - would include all, but we exclude helpers
  // For maximum flexibility, remove testfiles entirely to run all tests
  // Or use glob pattern to include specific patterns

  // Measure coverage for statements, branches, functions, and lines
  measureStatementCoverage: true,
  measureFunctionCoverage: true,
  measureBranchCoverage: true,
  measureLineCoverage: true,

  // Optionally configure which networks to use for coverage
  // providerOptions: {
  //   default_balance_ether: '10000000000000000000000000',
  // },

  // Optionally set which mocha reporter to use
  mocha: {
    grep: "@skip-on-coverage", // Filter describe/it with this comment
    invert: true // Run everything except those with @skip-on-coverage
  },

  // Configure Istanbul (the underlying coverage tool)
  istanbulReporter: ["html", "lcov", "text", "json"],
};
