import { useStore } from '../../store'
import { getContextLimit } from '../../constants/modelLimits'
import { formatTokens } from '../../utils/tokenFormat'
import './ContextIndicator.css'

export function ContextIndicator() {
  const selectedAtomId = useStore((s) => s.selectedAtomId)
  const atoms = useStore((s) => s.atoms)

  const atom = selectedAtomId ? atoms[selectedAtomId] : null
  const used = atom?.context_tokens_used ?? 0
  const model = atom?.model ?? ''
  const limit = atom?.context_window_limit ?? getContextLimit(model)

  if (used === 0) return null

  const pct = Math.min(100, (used / limit) * 100)
  const color: 'low' | 'mid' | 'high' =
    pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low'

  return (
    <div
      className={`ctx-badge ctx-badge--${color}`}
      title={`${formatTokens(used)} / ${formatTokens(limit)} · ${pct.toFixed(1)}%`}
    >
      {pct.toFixed(1)}%
    </div>
  )
}
