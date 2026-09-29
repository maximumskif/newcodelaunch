import type { DeploymentParam } from '../../lib/contractsApi'

interface Props {
  params: DeploymentParam[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}

// `param.name` is the literal Solidity template placeholder this value gets
// substituted into (e.g. `{{TOKEN_NAME}}` in the contract source, see
// backend/app/services/contract_templates.py) — a real functional
// identifier, not display copy. Formatting it for the label is purely
// cosmetic and never touches the value actually sent to the backend.
function humanizeParamName(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function TemplateForm({ params, values, onChange }: Props) {
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {params.map((param) => {
        const isAddress = param.type === 'address'
        const isNumber = param.type?.startsWith('uint')
        return (
          <label key={param.name} className={`flex flex-col gap-1.5 text-sm ${isAddress ? 'sm:col-span-2' : ''}`}>
            <span className="font-medium text-ink">
              {humanizeParamName(param.name)}
              {param.required && <span className="text-danger"> *</span>}
            </span>
            <input
              type="text"
              inputMode={isNumber ? 'numeric' : undefined}
              spellCheck={false}
              placeholder={isAddress ? '0x…' : undefined}
              value={values[param.name] ?? (param.default !== undefined ? String(param.default) : '')}
              onChange={(event) => onChange(param.name, event.target.value)}
              className={`h-10 rounded-md border border-border bg-canvas px-3 text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 ${
                isAddress || isNumber ? 'font-mono' : ''
              }`}
            />
            {/* A permanent hint, not a placeholder — placeholder text
                disappears on focus/input, exactly when a format hint like
                MINT_PRICE's "in wei" is most useful to still see. */}
            {param.description && <span className="text-xs text-ink-faint">{param.description}</span>}
          </label>
        )
      })}
    </div>
  )
}
