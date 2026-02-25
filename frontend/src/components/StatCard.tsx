interface Props {
  label: string
  value: string | number
  sub?: string
  color?: 'green' | 'red' | 'blue' | 'yellow' | 'default'
}

const colorMap = {
  green: 'text-[#26a69a]',
  red: 'text-[#ef5350]',
  blue: 'text-[#2196f3]',
  yellow: 'text-[#f59e0b]',
  default: 'text-white',
}

export default function StatCard({ label, value, sub, color = 'default' }: Props) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="text-[#787b86] text-xs">{label}</span>
      <span className={`text-xl font-bold font-mono ${colorMap[color]}`}>{value}</span>
      {sub && <span className="text-[#787b86] text-xs">{sub}</span>}
    </div>
  )
}
