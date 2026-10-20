import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useDeployContract, useWaitForTransactionReceipt } from 'wagmi'
import { isAddress } from 'viem'
import { toast } from 'sonner'
import { Loader2, ArrowUpRight, Store } from 'lucide-react'
import type { RegisterGuardContract } from '../types'
import { getUsdc } from '@/onchain-facts'
import { arcTxUrl } from '../utils/arcExplorer'
import { loadContractAddress, saveContractAddress } from '../utils/contractStorage'
import ARTIFACT from '../../contracts/out/RegisterGuardPOS.sol/RegisterGuardPOS.json'

interface Props {
  chainId: number
  onContractDeployed: (contract: RegisterGuardContract) => void
  onContractLoaded: (contract: RegisterGuardContract) => void
}

export function ContractSetup({ chainId, onContractDeployed, onContractLoaded }: Props) {
  const { address } = useAccount()
  const usdc = getUsdc(chainId)

  const isMainnet = chainId === 5042

  const [savedAddress, setSavedAddress] = useState<string>(() => {
    // URL param takes priority, then per-chain localStorage
    const params = new URLSearchParams(window.location.search)
    return params.get('contract') || loadContractAddress(chainId)
  })

  // When chainId changes (user switches network) re-load that chain's saved address
  const prevChainRef = useRef(chainId)
  useEffect(() => {
    if (chainId !== prevChainRef.current) {
      prevChainRef.current = chainId
      setSavedAddress(loadContractAddress(chainId))
    }
  }, [chainId])

  const [deployForm, setDeployForm] = useState({
    initialOwner: '',
    savingsVault: '',
    workingCapWallet: '',
    savingsBps: '2500',
    workingCapBps: '6000',
    supplierBps: '1000',
    bufferBps: '500',
    maxBuffer: '50000000',
  })

  const [showDeploy, setShowDeploy] = useState(!savedAddress)

  const { deployContract: deployTx, data: deployHash, isPending: deployPending } = useDeployContract()
  const { isLoading: deployConfirming, data: receipt } = useWaitForTransactionReceipt({ hash: deployHash })

  // Pre-fill address fields when wallet first connects
  const prevAddressRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (address && address !== prevAddressRef.current) {
      prevAddressRef.current = address
      setDeployForm(f => ({
        ...f,
        initialOwner: f.initialOwner || address,
        savingsVault: f.savingsVault || address,
        workingCapWallet: f.workingCapWallet || address,
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  const handleDeploy = useCallback(() => {
    if (!usdc) { toast.error('No USDC on this chain'); return }
    const fields = [deployForm.initialOwner, deployForm.savingsVault, deployForm.workingCapWallet]
    if (fields.some(a => !isAddress(a))) { toast.error('Invalid address in form'); return }
    const total =
      Number(deployForm.savingsBps) +
      Number(deployForm.workingCapBps) +
      Number(deployForm.supplierBps) +
      Number(deployForm.bufferBps)
    if (total !== 10000) { toast.error(`BPS must sum to 10000, got ${total}`); return }

    deployTx({
      abi: ARTIFACT.abi,
      bytecode: ARTIFACT.bytecode.object as `0x${string}`,
      args: [
        usdc.address as `0x${string}`,
        deployForm.initialOwner as `0x${string}`,
        deployForm.savingsVault as `0x${string}`,
        deployForm.workingCapWallet as `0x${string}`,
        Number(deployForm.savingsBps),
        Number(deployForm.workingCapBps),
        Number(deployForm.supplierBps),
        Number(deployForm.bufferBps),
        BigInt(deployForm.maxBuffer),
      ] as readonly unknown[],
      chainId,
    })
  }, [deployForm, usdc, chainId, deployTx])

  // When receipt arrives extract the contract address
  const processedReceiptRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const addr = receipt?.contractAddress
    if (addr && addr !== processedReceiptRef.current) {
      processedReceiptRef.current = addr
      saveContractAddress(chainId, addr)
      const url = new URL(window.location.href)
      url.searchParams.set('contract', addr)
      window.history.replaceState({}, '', url.toString())
      setSavedAddress(addr)
      onContractDeployed({ address: addr, abi: ARTIFACT.abi })
      toast.success('Contract deployed!')
    }
  }, [receipt, chainId, onContractDeployed])

  const handleLoadSaved = useCallback(() => {
    if (!isAddress(savedAddress)) { toast.error('Invalid contract address'); return }
    saveContractAddress(chainId, savedAddress)
    const url = new URL(window.location.href)
    url.searchParams.set('contract', savedAddress)
    window.history.replaceState({}, '', url.toString())
    onContractLoaded({ address: savedAddress, abi: ARTIFACT.abi })
  }, [savedAddress, chainId, onContractLoaded])

  const networkLabel = isMainnet ? 'Arc Mainnet' : 'Arc Testnet'

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4 gap-6">
      <div className="flex flex-col items-center gap-2 mb-2">
        <div className="w-12 h-12 rounded-2xl bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center">
          <Store size={22} className="text-[var(--accent)]" />
        </div>
        <h1 className="display text-2xl font-bold text-[var(--ink)] tracking-tight">RegisterGuard POS</h1>
        <p className="text-sm text-[var(--subtle)]">Non-custodial retail POS on {networkLabel}</p>
        {isMainnet && (
          <div className="px-3 py-1 rounded-full bg-[rgba(232,109,122,0.12)] border border-[var(--danger)] text-[var(--danger)] text-xs font-semibold">
            Mainnet — real USDC
          </div>
        )}
      </div>

      {/* Load existing contract */}
      <div className="glass w-full max-w-md p-5 flex flex-col gap-3">
        <span className="text-sm font-semibold text-[var(--ink)]">Load Existing Contract</span>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="0x... contract address"
            value={savedAddress}
            onChange={e => setSavedAddress(e.target.value)}
            className="flex-1 bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
          />
          <button
            onClick={handleLoadSaved}
            className="px-4 py-2 rounded-xl bg-[var(--accent)] text-[#0d1b2f] font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Load
          </button>
        </div>
      </div>

      {/* Deploy new */}
      <div className="glass w-full max-w-md p-5 flex flex-col gap-3">
        <button
          onClick={() => setShowDeploy(d => !d)}
          className="flex items-center justify-between w-full text-sm font-semibold text-[var(--ink)]"
        >
          <span>Deploy New Contract</span>
          <span className="text-[var(--subtle)] text-xs">{showDeploy ? '▲' : '▼'}</span>
        </button>

        {showDeploy && (
          <>
            {isMainnet && (
              <div className="px-3 py-2 rounded-xl bg-[rgba(232,109,122,0.08)] border border-[var(--danger)] text-[var(--danger)] text-xs">
                Deploying on Mainnet uses real USDC for gas. Ensure you have reviewed the contract and use a multisig as initial owner.
              </div>
            )}
            {[
              ['initialOwner', 'Initial Owner (multisig recommended)'],
              ['savingsVault', 'Owner Savings Vault'],
              ['workingCapWallet', 'Working Capital Wallet'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="text-xs text-[var(--muted)] mb-1 block">{label}</label>
                <input
                  type="text"
                  value={deployForm[field as keyof typeof deployForm]}
                  onChange={e => setDeployForm(f => ({ ...f, [field]: e.target.value }))}
                  className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs mono text-[var(--ink)] outline-none focus:border-[var(--border-strong)]"
                />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['savingsBps', 'Savings BPS'],
                ['workingCapBps', 'Working Cap BPS'],
                ['supplierBps', 'Supplier BPS'],
                ['bufferBps', 'Buffer BPS'],
              ].map(([field, label]) => (
                <div key={field}>
                  <label className="text-xs text-[var(--muted)] mb-1 block">{label}</label>
                  <input
                    type="number"
                    value={deployForm[field as keyof typeof deployForm]}
                    onChange={e => setDeployForm(f => ({ ...f, [field]: e.target.value }))}
                    className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] mb-1 block">Max Refund Buffer (USDC units)</label>
              <input
                type="number"
                value={deployForm.maxBuffer}
                onChange={e => setDeployForm(f => ({ ...f, maxBuffer: e.target.value }))}
                className="w-full bg-[var(--surface-muted)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm tabular-nums text-[var(--ink)] outline-none"
              />
            </div>
            <button
              onClick={handleDeploy}
              disabled={deployPending || deployConfirming}
              className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 ${
                isMainnet
                  ? 'bg-[var(--danger)] text-white'
                  : 'bg-[var(--cashier-accent)] text-[#0d1b2f]'
              }`}
            >
              {deployPending || deployConfirming ? (
                <><Loader2 size={13} className="animate-spin" /> {deployPending ? 'Confirm in wallet…' : 'Deploying…'}</>
              ) : (
                `Deploy on ${networkLabel}`
              )}
            </button>
            {deployHash && !receipt?.contractAddress && (
              <a
                href={arcTxUrl(chainId, deployHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--accent)] flex items-center gap-1 justify-center hover:underline"
              >
                Track deployment <ArrowUpRight size={10} />
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}
