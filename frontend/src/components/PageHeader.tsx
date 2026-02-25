interface Props {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="h-14 px-6 border-b border-[#2a2e39] flex items-center justify-between shrink-0 bg-[#1e2328]">
      <div>
        <h1 className="text-white font-semibold text-base">{title}</h1>
        {subtitle && <p className="text-[#787b86] text-xs mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
