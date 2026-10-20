import { useState, useCallback } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Store, LayoutPanelLeft, Settings2, ExternalLink, ArrowLeftRight } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { CashierPane } from './components/CashierPane'
import { CustomerPane } from './components/CustomerPane'
import { OwnerTab } from './components/OwnerTab'
import { BroadcastRelayer } from './components/BroadcastRelayer'
import { ContractSetup } from './components/ContractSetup'
import type {
  RegisterGuardContract,
  Invoice,
  QRPayload,
  EIP3009SignedPayload,
  RefundClaimPayload,
} from './types'
import { getUsdc } from '@/onchain-facts'
import { erc20Abi } from 'viem'
import { arcAddressUrl } from './utils/arcExplorer'
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './config'

type Tab = 'demo' | 'owner'

export default function App() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  // Active chain — follow the wallet, defaulting to Arc Mainnet
  const activeChainId = (chainId === ARC_MAINNET_ID || chainId === ARC_TESTNET_ID)
    ? chainId
    : ARC_MAINNET_ID

  const [contract, setContract] = useState<RegisterGuardContract | null>(null)
  const [setupChainId, setSetupChainId] = useState<number>(activeChainId)
  const [activeTab, setActiveTab] = useState<Tab>('demo')
  const [showSwitch, setShowSwitch] = useState(false)

  // Cross-pane shared state
  const [activeInvoicePayload, setActiveInvoicePayload] = useState<QRPayload | null>(null)
  const [pendingSignedPayload, setPendingSignedPayload] = useState<EIP3009SignedPayload | null>(null)
  const [activeRefundClaim, setActiveRefundClaim] = useState<RefundClaimPayload | null>(null)
  const [paidInvoices, setPaidInvoices] = useState<Invoice[]>([])

  const usdc = getUsdc(setupChainId)

  // Live USDC balance (ERC-20 view)
  const { data: usdcBalance } = useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: setupChainId,
    query: { enabled: !!address && !!usdc },
  })

  const handleInvoiceCreated = useCallback((payload: QRPayload) => {
    setActiveInvoicePayload(payload)
  }, [])

  const handleInvoicePaid = useCallback((invoice: Invoice) => {
    setPaidInvoices(prev => [invoice, ...prev.slice(0, 19)])
    // Bug 2: do NOT clear activeInvoicePayload here — CustomerPane keeps the
    // card visible and shows "Payment Confirmed" via its own wagmi paySuccess
    // state. Clearing it would unmount the card and lose the confirmation UI.
  }, [])

  const handleRefundClaimCreated = useCallback((payload: RefundClaimPayload) => {
    setActiveRefundClaim(payload)
  }, [])

  const handleSignedQR = useCallback((payload: EIP3009SignedPayload) => {
    setPendingSignedPayload(payload)
  }, [])

  const handleContractReady = useCallback((c: RegisterGuardContract) => {
    setContract(c)
    setShowSwitch(false)
  }, [])

  const handleSwitchChain = useCallback((targetChainId: number) => {
    setSetupChainId(targetChainId)
    setContract(null)           // force re-setup on new chain
    setPaidInvoices([])
    setActiveInvoicePayload(null)
    setActiveRefundClaim(null)
    setPendingSignedPayload(null)
    if (switchChain) switchChain({ chainId: targetChainId })
  }, [switchChain])

  // Setup screen (no contract loaded, or switch requested)
  if (!contract || showSwitch) {
    return (
      <div className="min-h-dvh">
        <Header
          address={address}
          chainId={chainId}
          activeChainId={setupChainId}
          usdcBalance={usdcBalance}
          contract={null}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onSwitchChain={handleSwitchChain}
          showSwitch={false}
          setShowSwitch={setShowSwitch}
        />
        <ContractSetup
          chainId={setupChainId}
          onContractDeployed={handleContractReady}
          onContractLoaded={handleContractReady}
        />
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <Header
        address={address}
        chainId={chainId}
        activeChainId={setupChainId}
        usdcBalance={usdcBalance}
        contract={contract}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSwitchChain={handleSwitchChain}
        showSwitch={showSwitch}
        setShowSwitch={setShowSwitch}
      />

      {activeTab === 'demo' ? (
        <div className="flex-1 flex flex-col">
          {/* Broadcast Relayer */}
          {pendingSignedPayload && (
            <div className="py-2">
              <BroadcastRelayer
                contract={contract}
                chainId={setupChainId}
                pendingSignedPayload={pendingSignedPayload}
              />
            </div>
          )}

          {/* Split-screen */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)]">
            <div className="min-h-[50vh] lg:min-h-0 overflow-y-auto">
              <CashierPane
                contract={contract}
                chainId={setupChainId}
                cashierAddress={address ?? '0x0000000000000000000000000000000000000000'}
                onInvoiceCreated={handleInvoiceCreated}
                onRefundClaimCreated={handleRefundClaimCreated}
                paidInvoices={paidInvoices}
                isCurrentInvoicePaid={
                  !!activeInvoicePayload &&
                  paidInvoices.some(p => p.invoiceId === activeInvoicePayload.invoiceId)
                }
              />
            </div>

            <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <div className="glass px-2 py-1 rounded-full text-xs text-[var(--subtle)]">
                ← split-screen →
              </div>
            </div>

            <div className="min-h-[50vh] lg:min-h-0 overflow-y-auto">
              <CustomerPane
                contract={contract}
                chainId={setupChainId}
                activeInvoice={activeInvoicePayload}
                activeRefundClaim={activeRefundClaim}
                onSignedQR={handleSignedQR}
                onInvoicePaid={handleInvoicePaid}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <OwnerTab
            contract={contract}
            chainId={setupChainId}
            ownerAddress={address ?? '0x0000000000000000000000000000000000000000'}
            paidInvoices={paidInvoices}
          />
        </div>
      )}
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

interface HeaderProps {
  address: `0x${string}` | undefined
  chainId: number | undefined
  activeChainId: number
  usdcBalance: bigint | undefined
  contract: RegisterGuardContract | null
  activeTab: Tab
  setActiveTab: (t: Tab) => void
  onSwitchChain: (chainId: number) => void
  showSwitch: boolean
  setShowSwitch: (v: boolean) => void
}

function Header({
  address,
  chainId,
  activeChainId,
  usdcBalance,
  contract,
  activeTab,
  setActiveTab,
  onSwitchChain,
  showSwitch,
  setShowSwitch,
}: HeaderProps) {
  const isArcMainnet  = chainId === ARC_MAINNET_ID
  const isArcTestnet  = chainId === ARC_TESTNET_ID
  const isArc = isArcMainnet || isArcTestnet

  const networkLabel = isArcMainnet ? 'Arc Mainnet' : isArcTestnet ? 'Arc Testnet' : chainId ? `Chain ${chainId}` : 'Not connected'
  const networkOk    = isArc && chainId === activeChainId

  return (
    <header className="glass-strong sticky top-0 z-30 px-4 py-3 flex items-center gap-2 flex-wrap">
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[var(--surface-muted)] border border-[var(--border)] flex items-center justify-center">
          <Store size={14} className="text-[var(--accent)]" />
        </div>
        <span className="display text-sm font-bold text-[var(--ink)] hidden sm:block">RegisterGuard</span>
      </div>

      {/* Contract address pill */}
      {contract && (
        <a
          href={arcAddressUrl(activeChainId, contract.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--border)] text-xs mono text-[var(--subtle)] hover:border-[var(--border-strong)] transition-colors"
        >
          {contract.address.slice(0, 8)}… <ExternalLink size={9} />
        </a>
      )}

      {/* Network pill */}
      <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
        networkOk
          ? isArcMainnet
            ? 'border-[var(--danger)] text-[var(--danger)] bg-[rgba(232,109,122,0.08)]'
            : 'border-[var(--success)] text-[var(--success)] bg-[rgba(141,216,159,0.08)]'
          : 'border-[var(--border)] text-[var(--subtle)]'
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${
          networkOk ? (isArcMainnet ? 'bg-[var(--danger)]' : 'bg-[var(--success)]') : 'bg-[var(--subtle)]'
        }`} />
        {networkLabel}
      </div>

      <div className="flex-1" />

      {/* Chain switcher — segmented toggle that calls switchChain */}
      <div className="hidden sm:flex items-center gap-0.5 bg-[var(--surface-muted)] p-1 rounded-xl border border-[var(--border)]">
        {[
          { id: ARC_MAINNET_ID,  label: 'Mainnet' },
          { id: ARC_TESTNET_ID,  label: 'Testnet' },
        ].map(opt => (
          <button
            key={opt.id}
            onClick={() => onSwitchChain(opt.id)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
              activeChainId === opt.id
                ? opt.id === ARC_MAINNET_ID
                  ? 'bg-[var(--danger)] text-white'
                  : 'bg-[var(--success)] text-[#0d1b2f]'
                : 'text-[var(--subtle)] hover:text-[var(--ink-2)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Switch / Deploy Contract button (opens setup screen) */}
      <button
        onClick={() => setShowSwitch(!showSwitch)}
        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--subtle)] hover:border-[var(--border-strong)] hover:text-[var(--ink-2)] transition-colors"
      >
        <ArrowLeftRight size={11} />
        Contract
      </button>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-[var(--surface-muted)] p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('demo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'demo'
              ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
              : 'text-[var(--subtle)] hover:text-[var(--ink-2)]'
          }`}
        >
          <LayoutPanelLeft size={11} />
          <span className="hidden sm:inline">Split-Screen Demo</span>
          <span className="sm:hidden">Demo</span>
        </button>
        <button
          onClick={() => setActiveTab('owner')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'owner'
              ? 'bg-[var(--surface-strong)] text-[var(--ink)]'
              : 'text-[var(--subtle)] hover:text-[var(--ink-2)]'
          }`}
        >
          <Settings2 size={11} />
          <span className="hidden sm:inline">Owner Treasury</span>
          <span className="sm:hidden">Owner</span>
        </button>
      </div>

      {/* USDC balance */}
      {address && usdcBalance !== undefined && (
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-muted)] border border-[var(--border)]">
          <TokenUSDC size={14} variant="branded" />
          <span className="tabular-nums text-xs font-semibold text-[var(--ink)]">
            ${(Number(usdcBalance) / 1_000_000).toFixed(2)}
          </span>
        </div>
      )}

      <ConnectKitButton />


    </header>
  )
}
