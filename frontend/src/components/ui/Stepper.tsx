import { IconCheck } from './icons'

export interface StepInfo {
  id: string
  label: string
  done: boolean
}

export function Stepper({ steps, activeId }: { steps: StepInfo[]; activeId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {steps.map((step, index) => {
        const isActive = step.id === activeId
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${
                step.done
                  ? 'bg-success/15 text-success ring-success/30'
                  : isActive
                    ? 'bg-accent-600 text-white ring-transparent'
                    : 'bg-surface-hover text-ink-faint ring-border'
              }`}
            >
              {step.done ? <IconCheck className="h-3.5 w-3.5" /> : index + 1}
            </div>
            <span className={`text-sm ${isActive ? 'font-medium text-ink' : 'text-ink-muted'}`}>{step.label}</span>
            {index < steps.length - 1 && <div className="mx-2 h-px w-8 bg-border" />}
          </div>
        )
      })}
    </div>
  )
}
