import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import * as dotenv from "dotenv";
dotenv.config({ path: "../scripts/probe/.env.local" });

const KEY = process.env.PROBE_PRIVATE_KEY;

const config: HardhatUserConfig = {
  // Pinned by @somnia-chain/reactivity-contracts, which declares `pragma solidity 0.8.30`.
  solidity: {
    version: "0.8.30",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    shannon: {
      url: "https://dream-rpc.somnia.network",
      chainId: 50312,
      accounts: KEY ? [KEY] : [],
    },
  },
};

export default config;
