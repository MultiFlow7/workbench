import React, { useEffect, useState, Component, ReactNode } from 'react'
import { useStore } from './store'
import { Layout } from './components/Layout/Layout'
import { TopBar } from './components/TopBar/TopBar'
import { NavIcons } from './components/NavIcons/NavIcons'
import { NavList } from './components/NavList/NavList'
import { BranchTree } from './components/BranchTree/BranchTree'
// v0.15.1 节点 1.4：ChatView 已被 ChatViewV2 替代，保留 import 以便快速回滚
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ChatView as _ChatViewLegacy } from './components/ChatView/ChatView'
import { ChatViewV2 } from './components/ChatViewV2/ChatViewV2'
import { DetailPanel } from './components/DetailPanel/DetailPanel'
import { DecisionInbox } from './components/DecisionInbox/DecisionInbox'
import { DecisionPanel } from './components/DecisionPanel/DecisionPanel'
import { TokenAnalyticsPanel } from './components/TokenAnalytics/TokenAnalyticsPanel'
import { DashboardView } from './components/Dashboard/DashboardView'
import { TaskOverview } from './components/TaskOverview/TaskOverview'
import { TaskTriggerForm } from './components/TaskTrigger/TaskTriggerForm'
import { AgentList } from './components/AgentRegistry/AgentList'
import { AgentDetail } from './components/AgentRegistry/AgentDetail'
import { CapabilityTokenTab } from './components/AgentRegistry/CapabilityTokenTab'
import type { AgentInfo } from './components/AgentRegistry/AgentList'
import { useBackendHealth } from './hooks/useBackendHealth'
import { useBackendSSE } from './hooks/useBackendSSE'
import { useNotifications } from './hooks/useNotifications'
import { hydrateSettingsFromFile } from './store/settingsSlice'
// v0.16 R-3 / R-4：Vault 配置启动门 + Settings 视图（FirstLaunchToast 在 R-5 节点接入）
import { VaultBootGate } from './components/VaultBootGate'
import { SettingsView } from './components/Settings/SettingsView'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(e: Error) { return { error: e } }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, padding: 24,
          background: '#fff2f2', color: '#b91c1c',
          fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
          overflowY: 'auto', zIndex: 9999,
        }}>
          {'[ErrorBoundary] 渲染错误:\n' + error.message + '\n\n' + error.stack}
        </div>
      )
    }
    return this.props.children
  }
}

// v0.6: Console mode P3 — Tab between TaskOverview and DecisionInbox
function ConsoleTabView({ onTriggerTask }: { onTriggerTask: () => void }) {
  const [activeTab, setActiveTab] = useState<'tasks' | 'decisions'>('tasks')

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px 6px',
    border: 'none',
    background: 'transparent',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#2563eb' : '#71717a',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    cursor: 'pointer',
    borderRadius: '6px 6px 0 0',
    fontFamily: 'inherit',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '8px 12px 0',
        background: '#ffffff',
        borderBottom: '1px solid #e4e4e7',
        flexShrink: 0,
      }}>
        <button
          style={tabBtnStyle(activeTab === 'tasks')}
          onClick={() => setActiveTab('tasks')}
        >
          任务总览
        </button>
        <button
          style={tabBtnStyle(activeTab === 'decisions')}
          onClick={() => setActiveTab('decisions')}
        >
          决策收件箱
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'tasks' ? (
          <TaskOverview onTriggerTask={onTriggerTask} />
        ) : (
          <DecisionInbox />
        )}
      </div>
    </div>
  )
}

function App() {
  const loadAtoms = useStore((s) => s.loadAtoms)
  const loadProjects = useStore((s) => s.loadProjects)
  const currentMode = useStore((s) => s.currentMode)

  // v0.6: console mode — trigger form shown in P4
  const [showTriggerForm, setShowTriggerForm] = useState(false)

  // v0.6: tools mode — selected Agent for P4 detail
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null)

  // v0.8: tools mode P3 tab ('agents' | 'tokens')
  const [toolsTab, setToolsTab] = useState<'agents' | 'tokens'>('agents')

  // v0.2: mount backend hooks
  useBackendHealth()
  useBackendSSE()
  // v0.7: mount notifications hook (全程常驻，对话模式下也保持连接)
  useNotifications()

  useEffect(() => {
    // Fallback: re-run settings hydration after mount in case bootstrap() failed before IPC was ready
    hydrateSettingsFromFile((partial) => useStore.setState(partial))
    loadAtoms().then(() => {
      const count = Object.keys(useStore.getState().atoms).length
      window.api.invoke('write_event_log', { event: { event: 'app_launch', timestamp: new Date().toISOString(), payload: { version: '0.6.0', qa_atom_count: count } } }).catch(() => {})
    }).catch(console.error)
    loadProjects().catch(console.error)
  }, [loadAtoms, loadProjects])

  // v0.6: P2 switches by mode
  // tools mode: P2 shows AgentList
  const p2Content =
    currentMode === 'tools' ? (
      <AgentList
        selectedRole={selectedAgent?.role ?? null}
        onSelect={(role) => {
          setSelectedAgent({
            role,
            description: '',
            running_count: 0,
            awaiting_count: 0,
            failed_count: 0,
          })
        }}
      />
    ) :
    <BranchTree />

  // v0.6: P3 switches by mode
  const p3Content =
    currentMode === 'decisions' ? <DecisionInbox /> :
    currentMode === 'analytics' ? <TokenAnalyticsPanel /> :
    currentMode === 'dashboard' ? <DashboardView /> :
    currentMode === 'settings' ? <SettingsView /> :
    currentMode === 'console' ? (
      <ConsoleTabView onTriggerTask={() => setShowTriggerForm(true)} />
    ) :
    currentMode === 'tools' ? (
      // v0.8: tools mode P3 — tab between agent hint and token management
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '8px 12px 0',
          background: '#ffffff',
          borderBottom: '1px solid #e4e4e7',
          flexShrink: 0,
        }}>
          <button
            style={{
              padding: '5px 12px 6px',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: toolsTab === 'agents' ? 600 : 400,
              color: toolsTab === 'agents' ? '#2563eb' : '#71717a',
              borderBottom: toolsTab === 'agents' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
              borderRadius: '6px 6px 0 0',
              fontFamily: 'inherit',
            }}
            onClick={() => setToolsTab('agents')}
          >
            Agent 注册表
          </button>
          <button
            style={{
              padding: '5px 12px 6px',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: toolsTab === 'tokens' ? 600 : 400,
              color: toolsTab === 'tokens' ? '#2563eb' : '#71717a',
              borderBottom: toolsTab === 'tokens' ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
              borderRadius: '6px 6px 0 0',
              fontFamily: 'inherit',
            }}
            onClick={() => setToolsTab('tokens')}
          >
            令牌管理
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {toolsTab === 'agents' ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: 13,
              color: '#a1a1aa',
            }}>
              从左侧选择 Agent 查看详情
            </div>
          ) : (
            <CapabilityTokenTab />
          )}
        </div>
      </div>
    ) :
    // v0.15.1 节点 1.4：chat 模式 P3 渲染器替换为 ChatViewV2
    // ChatView 保留 import 不删，便于回滚（参考 technical.md 关键技术决策 5）
    <ChatViewV2 />

  // v0.6: P4 switches by mode
  const p4Content =
    currentMode === 'decisions' ? <DecisionPanel /> :
    currentMode === 'analytics' ? null :
    currentMode === 'console' && showTriggerForm ? (
      <TaskTriggerForm onClose={() => setShowTriggerForm(false)} />
    ) :
    currentMode === 'tools' ? (
      <AgentDetail agent={selectedAgent} />
    ) :
    <DetailPanel />

  return (
    <ErrorBoundary>
      <VaultBootGate>
        <Layout
          topBar={<TopBar />}
          p1Icons={<NavIcons />}
          p1List={<NavList />}
          p2={p2Content}
          p3={p3Content}
          p4={p4Content}
        />
      </VaultBootGate>
    </ErrorBoundary>
  )
}

export default App
