import type { DeploymentParam } from '../../lib/contractsApi'

interface Props {
  params: DeploymentParam[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}

export function TemplateForm({ params, values, onChange }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {params.map((param) => (
        <label key={param.name} className="flex flex-col gap-1 text-sm">
          <span className="text-white/70">
            {param.name}
            {param.required && <span className="text-red-400"> *</span>}
          </span>
          <input
            type="text"
            value={values[param.name] ?? (param.default !== undefined ? String(param.default) : '')}
            onChange={(event) => onChange(param.name, event.target.value)}
            placeholder={param.description}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-white placeholder:text-white/30"
          />
        </label>
      ))}
    </div>
  )
}
