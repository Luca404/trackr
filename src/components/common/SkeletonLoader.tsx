function SkeletonCard({ lines = 2, short = false }: { lines?: number; short?: boolean }) {
  return (
    <div className="card animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2 last:mb-0 ${
            i === 0 ? (short ? 'w-1/3' : 'w-2/5') : i === lines - 1 ? 'w-1/2' : 'w-3/4'
          }`}
        />
      ))}
    </div>
  );
}

export default function SkeletonLoader() {
  return (
    <div className="space-y-3">
      <SkeletonCard lines={1} short />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </div>
  );
}
