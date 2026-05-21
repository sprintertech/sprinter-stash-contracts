import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import {
  AbstractSigner, NonceManager, Provider, Signer,
  TransactionReceipt, TransactionRequest, TransactionResponse,
  TypedDataDomain, TypedDataField, getAddress, resolveAddress,
} from 'ethers';
import {HardhatNetworkConfig, HardhatRuntimeEnvironment} from 'hardhat/types';
import {assert, assertAddress, CREATE_X_ADDRESS, sameAddress} from './common';

export class SafeSigner extends AbstractSigner {
  private readonly protocolKit: Safe;
  private readonly apiKit: SafeApiKit;
  private readonly safeAddress: string;
  private readonly signerAddress: string;
  private readonly eoa: Signer;
  private readonly threshold: number;
  private readonly hre: HardhatRuntimeEnvironment;

  private constructor(
    protocolKit: Safe,
    apiKit: SafeApiKit,
    safeAddress: string,
    signerAddress: string,
    eoa: Signer,
    provider: Provider,
    threshold: number,
    hre: HardhatRuntimeEnvironment,
  ) {
    super(provider);
    this.protocolKit = protocolKit;
    this.apiKit = apiKit;
    this.safeAddress = safeAddress;
    this.signerAddress = signerAddress;
    this.eoa = eoa;
    this.threshold = threshold;
    this.hre = hre;
  }

  static async create(rpcUrl: string, safeAddress: string, eoa: Signer, chainId: bigint, hre: HardhatRuntimeEnvironment): Promise<SafeSigner> {
    assert(process.env.PRIVATE_KEY, 'PRIVATE_KEY env var is required to use Safe');

    const protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: process.env.PRIVATE_KEY,
      safeAddress,
    });

    const signerAddress = await eoa.getAddress();
    assert(
      await protocolKit.isOwner(signerAddress),
      `Signer ${signerAddress} is not an owner of Safe ${safeAddress}`,
    );
    console.log(`Safe ${safeAddress}: verified ${signerAddress} as owner.`);

    assert(eoa.provider, 'Signer must be connected to a provider to use Safe');
    const threshold = await protocolKit.getThreshold();
    const apiKit = new SafeApiKit({chainId, apiKey: process.env.SAFE_API_KEY});
    return new SafeSigner(protocolKit, apiKit, getAddress(safeAddress), signerAddress, eoa, eoa.provider, threshold, hre);
  }

  async getAddress(): Promise<string> {
    return this.safeAddress;
  }

  connect(provider: Provider | null): SafeSigner {
    assert(provider, 'SafeSigner requires a non-null provider');
    return new SafeSigner(
      this.protocolKit,
      this.apiKit,
      this.safeAddress,
      this.signerAddress,
      this.eoa,
      provider,
      this.threshold,
      this.hre,
    );
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    return this.eoa.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this.eoa.signMessage(message);
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    return this.eoa.signTypedData(domain, types, value);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    // Use EOA to deploy new contracts.
    if (!tx.to || sameAddress(tx.to, CREATE_X_ADDRESS)) {
      return this.eoa.sendTransaction(tx);
    }
    if (this.hre.network.name === "hardhat") {
      const impersonatedSafe = await this.hre.ethers.getImpersonatedSigner(this.safeAddress);
      // Send a dummy transaction to itself to update the nonce.
      await this.eoa.sendTransaction({to: this.signerAddress});
      return impersonatedSafe.sendTransaction(tx);
    }

    const to = tx.to ? await resolveAddress(tx.to) : undefined;
    assert(to, 'Transaction must have a recipient');
    const data = typeof tx.data === 'string' ? tx.data : '0x';
    const value = (tx.value ?? 0n).toString();

    const safeTransaction = await this.protocolKit.createTransaction({
      transactions: [{to, value, data}],
    });
    const safeTxHash = await this.protocolKit.getTransactionHash(safeTransaction);
    const signedTx = await this.protocolKit.signTransaction(safeTransaction);
    const sig = signedTx.signatures.get(this.signerAddress.toLowerCase());
    assert(sig, 'Failed to sign Safe transaction');

    await this.apiKit.proposeTransaction({
      safeAddress: this.safeAddress,
      safeTransactionData: signedTx.data,
      safeTxHash,
      senderAddress: this.signerAddress,
      senderSignature: sig.data,
    });
    console.log(`Transaction proposed to Safe ${this.safeAddress}. Safe TX hash: ${safeTxHash}`);

    const pendingTx = await this.apiKit.getTransaction(safeTxHash);
    const confirmations = pendingTx.confirmations?.length ?? 0;

    if (confirmations >= this.threshold) {
      console.log(`Threshold met (${confirmations}/${this.threshold}). Executing on-chain...`);
      const execResult = await this.protocolKit.executeTransaction(signedTx);
      const txHash = execResult.hash;
      console.log(`Executed. On-chain TX hash: ${txHash}`);
      const response = await this.provider!.getTransaction(txHash);
      assert(response, `Could not fetch transaction ${txHash}`);
      return response;
    }

    console.log(`Waiting for more signatures (${confirmations}/${this.threshold} confirmed).`);
    // Return a minimal response; wait() yields null since there is no on-chain receipt yet.
    return {
      provider: this.provider,
      hash: safeTxHash,
      wait: async (): Promise<TransactionReceipt | null> => null,
    } as TransactionResponse;
  }
}

// Returns a SafeSigner when SAFE env var is set, otherwise a NonceManager-wrapped signer.
export async function createSender(hre: HardhatRuntimeEnvironment, admin: Signer): Promise<Signer> {
  const safeAddress = process.env.SAFE;
  if (safeAddress) {
    assertAddress(safeAddress, "SAFE must be a valid address");
    let rpcUrl = (hre.network.config as {url?: string}).url;
    if (hre.network.name === "hardhat") {
      rpcUrl = (hre.network.config as HardhatNetworkConfig).forking?.url;
    }
    assert(rpcUrl, 'Network RPC URL is required for Safe transactions');
    return SafeSigner.create(rpcUrl, safeAddress, admin, BigInt(hre.network.config.chainId!), hre);
  }
  return new NonceManager(admin);
}
