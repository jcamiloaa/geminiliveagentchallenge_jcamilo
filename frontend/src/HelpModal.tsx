import { getHelp } from './i18n'

interface HelpModalProps {
  language: string
  onClose: () => void
}

export default function HelpModal({ language, onClose }: HelpModalProps) {
  const help = getHelp(language)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white">{help.helpTitle}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition text-lg leading-none">✕</button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Tabs section */}
          <div className="space-y-3">
            {help.tabs.map((tab, i) => (
              <div key={i}>
                <h3 className="text-[12px] font-semibold text-white/90 mb-1">{tab.title}</h3>
                <p className="text-[11px] text-white/55 leading-relaxed">{tab.body}</p>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-white/10" />

          {/* Agents section */}
          <div>
            <h3 className="text-[12px] font-bold text-purple-300 mb-3">{help.agentsTitle}</h3>
            <div className="space-y-3">
              {help.agents.map((agent, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
                  <h4 className="text-[11px] font-semibold text-white/90 mb-0.5">{agent.title}</h4>
                  <p className="text-[10px] text-white/50 leading-relaxed">{agent.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
