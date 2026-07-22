export const DEFAULT_PROXY_TYPE = "TransparentUpgradeableProxy";

// Upgradeable contracts proxies are deployed once with the contract name suffix in id.
// Subsequent implementation just use UPGRADE_ID env variable.
// Immutable contracts are deployed first with the name-derived unique id.
// Subsequent versions use version suffix plus a git commit from the main branch.
export const LiquidityPoolId = "LiquidityPool";
export const LiquidityPoolAaveId = "LiquidityPoolAave";
export const LiquidityPoolAaveLongTermId = "LiquidityPoolAaveLongTerm";
export const LiquidityPoolStablecoinId = "LiquidityPoolStablecoin";
export const LiquidityPoolPublicId = "LiquidityPoolPublic";
export const ERC4626AdapterId = "ERC4626Adapter";

export const LiquidityPoolProxy = DEFAULT_PROXY_TYPE + LiquidityPoolId;
export const LiquidityPoolAaveProxy = DEFAULT_PROXY_TYPE + LiquidityPoolAaveId;
export const LiquidityPoolLongTermProxy = DEFAULT_PROXY_TYPE + LiquidityPoolAaveLongTermId;
export const LiquidityPoolStablecoinProxy = DEFAULT_PROXY_TYPE + LiquidityPoolStablecoinId;
export const LiquidityPoolPublicProxy = DEFAULT_PROXY_TYPE + LiquidityPoolPublicId;
export const ERC4626AdapterProxy = DEFAULT_PROXY_TYPE + ERC4626AdapterId;

export const LiquidityPoolAaveUSDC = "LiquidityPoolAaveUSDC";
export const LiquidityPoolUSDC = "LiquidityPoolUSDC";
export const LiquidityPoolEURe = "LiquidityPoolEURe";
export const LiquidityPoolPublicUSDC = "LiquidityPoolPublicUSDC";
export const LiquidityPoolUSDCStablecoin = "LiquidityPoolUSDCStablecoin";
export const LiquidityPoolAaveUSDCLongTerm = "LiquidityPoolAaveUSDCLongTerm";
export const ERC4626AdapterUSDC = "ERC4626AdapterUSDC";

export const LiquidityPoolAaveUSDCLongTermV2 = "LiquidityPoolAaveUSDCLongTerm-V2-e09cc75";
export const LiquidityPoolAaveUSDCV2 = "LiquidityPoolAaveUSDC-V2-3601cc4";
export const LiquidityPoolUSDCV2 = "LiquidityPoolUSDC-V2-3601cc4";
export const LiquidityPoolUSDCStablecoinV2 = "LiquidityPoolUSDCStablecoin-V2-3601cc4";

export const LiquidityPoolAaveUSDCV3 = "LiquidityPoolAaveUSDC-V3-e09cc75";
export const LiquidityPoolUSDCV3 = "LiquidityPoolUSDC-V3-e09cc75";
export const LiquidityPoolUSDCStablecoinV3 = "LiquidityPoolUSDCStablecoin-V3-e09cc75";

export const LiquidityPoolAaveUSDCV4 = "LiquidityPoolAaveUSDC-V4-7187ffa";
export const LiquidityPoolUSDCV4 = "LiquidityPoolUSDC-V4-7187ffa";
export const LiquidityPoolPublicUSDCV2 = "LiquidityPoolPublicUSDC-V2-7187ffa";
export const LiquidityPoolUSDCStablecoinV4 = "LiquidityPoolUSDCStablecoin-V4-7187ffa";
export const LiquidityPoolAaveUSDCLongTermV3 = "LiquidityPoolAaveUSDCLongTerm-V3-7187ffa";
export const ERC4626AdapterUSDCV2 = "ERC4626AdapterUSDC-V2-7187ffa";

export const LiquidityPoolAaveUSDCProxy = DEFAULT_PROXY_TYPE + LiquidityPoolAaveUSDC;
export const LiquidityPoolUSDCProxy = DEFAULT_PROXY_TYPE + LiquidityPoolUSDC;
export const LiquidityPoolPublicUSDCProxy = DEFAULT_PROXY_TYPE + LiquidityPoolPublicUSDC;
export const LiquidityPoolStablecoinUSDCProxy = DEFAULT_PROXY_TYPE + "LiquidityPoolStablecoinUSDC";
export const LiquidityPoolAaveLongTermUSDCProxy = DEFAULT_PROXY_TYPE + "LiquidityPoolAaveLongTermUSDC";
export const ERC4626AdapterUSDCProxy = DEFAULT_PROXY_TYPE + ERC4626AdapterUSDC;
export const LiquidityPoolEUReProxy = DEFAULT_PROXY_TYPE + LiquidityPoolEURe;
export const LiquidityPoolAaveUSDCLongTermVersions = [
  LiquidityPoolAaveUSDCLongTerm,
  LiquidityPoolAaveUSDCLongTermV2,
  LiquidityPoolAaveUSDCLongTermV3,
  LiquidityPoolAaveLongTermUSDCProxy,
] as const;
export const LiquidityPoolAaveUSDCVersions = [
  LiquidityPoolAaveUSDC,
  LiquidityPoolAaveUSDCV2,
  LiquidityPoolAaveUSDCV3,
  LiquidityPoolAaveUSDCV4,
  LiquidityPoolAaveUSDCProxy,
] as const;
export const LiquidityPoolUSDCVersions = [
  LiquidityPoolUSDC,
  LiquidityPoolUSDCV2,
  LiquidityPoolUSDCV3,
  LiquidityPoolUSDCV4,
  LiquidityPoolUSDCProxy,
] as const;
export const LiquidityPoolEUReVersions = [
  LiquidityPoolEURe,
  LiquidityPoolEUReProxy,
] as const;
export const LiquidityPoolUSDCStablecoinVersions = [
  LiquidityPoolUSDCStablecoin,
  LiquidityPoolUSDCStablecoinV2,
  LiquidityPoolUSDCStablecoinV3,
  LiquidityPoolUSDCStablecoinV4,
  LiquidityPoolStablecoinUSDCProxy,
] as const;
export const LiquidityPoolPublicUSDCVersions = [
  LiquidityPoolPublicUSDC,
  LiquidityPoolPublicUSDCV2,
  LiquidityPoolPublicUSDCProxy,
] as const;
export const ERC4626AdapterUSDCVersions = [
  ERC4626AdapterUSDC,
  ERC4626AdapterUSDCV2,
  ERC4626AdapterUSDCProxy,
] as const;

export const RepayerProxy = DEFAULT_PROXY_TYPE + "Repayer";
export const PYUSDStashDexProcessorProxy = DEFAULT_PROXY_TYPE + "StashDexProcessorPYUSD";
export const USDCStashDexProcessorProxy = DEFAULT_PROXY_TYPE + "StashDexProcessorUSDC";
export const USDGStashDexProcessorProxy = DEFAULT_PROXY_TYPE + "StashDexProcessorUSDG";
export const USDTStashDexProcessorProxy = DEFAULT_PROXY_TYPE + "StashDexProcessorUSDT";
export const StashStablecoinDexProxy = DEFAULT_PROXY_TYPE + "StashStablecoinDex";
export const SUPPORTS_ONLY_USDC = false;
