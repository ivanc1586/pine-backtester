export default function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center">
      <div
        className="border-2 border-[#2a2e39] border-t-[#2196f3] rounded-full animate-spin"
        style={{ width: size, height: size }}
      />
    </div>
  )
}
