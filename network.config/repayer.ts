import {Network, Provider, StandaloneRepayersConfig} from "./types";

export const repayerConfig: StandaloneRepayersConfig = {
  BASE: {
    SparkStage: {
      ChainId: 8453,
      AcrossV3SpokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      StargateTreasurer: "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.BASE]: [Provider.LOCAL],
            [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.STARGATE],
            [Network.OP_MAINNET]: [Provider.ACROSS, Provider.STARGATE],
          },
        },
      },
      Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  ARBITRUM_ONE: {
    SparkStage: {
      ChainId: 42161,
      AcrossV3SpokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      StargateTreasurer: "0x146c8e409C113ED87C6183f4d25c50251DFfbb3a",
      WrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.ARBITRUM_ONE]: [Provider.LOCAL],
            [Network.BASE]: [Provider.ACROSS, Provider.STARGATE],
            [Network.OP_MAINNET]: [Provider.ACROSS, Provider.STARGATE],
          },
        },
      },
      Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
  OP_MAINNET: {
    SparkStage: {
      ChainId: 10,
      AcrossV3SpokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      StargateTreasurer: "0x644abb1e17291b4403966119d15Ab081e4a487e9",
      WrappedNativeToken: "0x4200000000000000000000000000000000000006",
      RepayerRoutes: {
        "0xa21007B5BC5E2B488063752d1BE43C0f3f376743": {
          SupportsAllTokens: true,
          Domains: {
            [Network.OP_MAINNET]: [Provider.LOCAL],
            [Network.ARBITRUM_ONE]: [Provider.ACROSS, Provider.STARGATE],
            [Network.BASE]: [Provider.ACROSS, Provider.STARGATE],
          },
        },
      },
      Admin: "0xA8eeA59b4A17CE2689E57B4dE9e825FD25705414",
      RepayerCallers: ["0x6D2C6B7B16f95B123dD3F536DCb96CB9B65d2aa3", "0xc1d6EEa5ce163d7D9f1952Db220830Aae16Cb607"],
    },
  },
};
