    // SPDX-License-Identifier: AGPL-3.0-or-later
    pragma solidity 0.8.28;

    import {CryticERC4626PropertyTests} from "@crytic/properties/contracts/ERC4626/ERC4626PropertyTests.sol";
    import {AdditionalProperties_hub} from "./AdditionalProperties_hub.sol";
    // this token _must_ be the vault's underlying asset
    import {TestERC20Token} from "@crytic/properties/contracts/ERC4626/util/TestERC20Token.sol";
    // change to your vault implementation
    import {LiquidityHub} from "../../LiquidityHub.sol";
    // import {TestUSDC} from "../testing/TestUSDC.sol";
    import {TestLiquidityPool} from "../../testing/TestLiquidityPool.sol";
    import {IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
    import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
    import {TestShareToken} from "./TestShareToken.sol";

    contract LiquidityHubInternal is LiquidityHub {

        constructor(address _shares, address pool)
            LiquidityHub(_shares, pool)
        {}

        function recognizeProfit(uint256 profit) public {
            TestERC20Token(asset()).mint(address(LIQUIDITY_POOL), profit);
            this.adjustTotalAssets(profit, true);
        }

        function recognizeLoss(uint256 loss) public {
            TestERC20Token(asset()).burn(address(LIQUIDITY_POOL), loss);
            this.adjustTotalAssets(loss, false);
        }
    }

    contract CryticERC4626Harness is 
        AdditionalProperties_hub, CryticERC4626PropertyTests
        
    {
        constructor () {
            TestERC20Token _asset = new TestERC20Token("Test Token", "TT", 18);

            TestLiquidityPool pool = new TestLiquidityPool(IERC20(address(_asset)), address(this));
            TestShareToken _shares = new TestShareToken("Shares Token", "ST", 18);

            // Impl
            address hubImpl = address(new LiquidityHubInternal(address(_shares), address(pool)));
            // Proxy 
            LiquidityHubInternal hubProxy = LiquidityHubInternal(address(new ERC1967Proxy(address(hubImpl), "")));
            hubProxy.initialize(
                IERC20(address(_asset)),
                address(this),
                address(this),
                address(this),
                address(this),
                type(uint256).max);
            hubProxy.grantRole(hubProxy.ASSETS_ADJUST_ROLE(), address(hubProxy));
            pool.grantRole(pool.LIQUIDITY_ADMIN_ROLE(), address(hubProxy));
            initialize(address(hubProxy), address(_asset), true);
            initialize(_shares);
        }
    }