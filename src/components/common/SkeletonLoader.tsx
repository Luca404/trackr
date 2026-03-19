function Bone({ className }: { className?: string }) {
  return <div className={`bg-gray-200 dark:bg-gray-700 rounded ${className}`} />;
}

export function TransactionsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* PeriodSelector */}
      <div className="flex gap-2">
        {['w-14', 'w-16', 'w-16', 'w-16', 'w-10'].map((w, i) => (
          <Bone key={i} className={`h-9 ${w} rounded-full`} />
        ))}
      </div>
      {/* Transaction rows */}
      <div className="space-y-2">
        {[70, 50, 85, 60, 75].map((w, i) => (
          <div key={i} className="card flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Bone className="w-10 h-10 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className={`h-4 w-${Math.round(w / 10) * 10 > 60 ? '2/5' : '1/3'}`} style={{ width: `${w * 0.4}%` }} />
                <Bone className="h-3" style={{ width: `${w * 0.6}%` }} />
              </div>
            </div>
            <div className="ml-4 space-y-2 items-end flex flex-col">
              <Bone className="h-5 w-20" />
              <Bone className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Liquidity card */}
      <div className="card text-center py-6 space-y-3">
        <Bone className="h-3 w-24 mx-auto" />
        <Bone className="h-10 w-40 mx-auto rounded-lg" />
      </div>
      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Bone className="w-12 h-12 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-1/2" />
                <Bone className="h-3 w-1/3" />
              </div>
            </div>
            <Bone className="h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CategoriesSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* PeriodSelector */}
      <div className="flex gap-2">
        {['w-14', 'w-16', 'w-16', 'w-16', 'w-10'].map((w, i) => (
          <Bone key={i} className={`h-9 ${w} rounded-full`} />
        ))}
      </div>
      {/* Filter tabs */}
      <div className="flex gap-2">
        {['w-24', 'w-24', 'w-32'].map((w, i) => (
          <Bone key={i} className={`h-9 ${w} rounded-lg`} />
        ))}
      </div>
      {/* Category grid */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 flex flex-col items-center"
            style={{ minHeight: '7.75rem' }}
          >
            <Bone className="w-10 h-10 rounded-full mb-2" />
            <Bone className="h-3 w-3/4 mb-2" />
            <Bone className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsSkeleton() {
  const barHeights = [60, 80, 45, 90, 70, 55, 85, 40, 75, 65, 50, 95];
  return (
    <div className="space-y-4 animate-pulse">
      {/* PeriodSelector */}
      <div className="flex gap-2">
        {['w-14', 'w-16', 'w-16', 'w-16', 'w-10'].map((w, i) => (
          <Bone key={i} className={`h-9 ${w} rounded-full`} />
        ))}
      </div>
      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2">
            <Bone className="h-3 w-16" />
            <Bone className="h-7 w-28" />
          </div>
        ))}
      </div>
      {/* Filter tabs */}
      <div className="flex gap-2">
        {['w-24', 'w-24', 'w-32'].map((w, i) => (
          <Bone key={i} className={`h-9 ${w} rounded-lg`} />
        ))}
      </div>
      {/* Bar chart */}
      <div className="card">
        <div className="flex items-end gap-1" style={{ height: '160px' }}>
          {barHeights.map((h, i) => (
            <Bone key={i} className="flex-1 rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header con periodo */}
      <div className="flex justify-between items-center">
        <Bone className="h-8 w-28 rounded-lg" />
        <Bone className="h-9 w-32 rounded-lg" />
      </div>
      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2">
            <Bone className="h-3 w-16" />
            <Bone className="h-7 w-28" />
          </div>
        ))}
      </div>
      {/* Recent transactions */}
      <div className="card space-y-3">
        <Bone className="h-5 w-40 mb-1" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-1/3" />
              <Bone className="h-3 w-1/4" />
            </div>
            <Bone className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PortfoliosSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card">
          <div className="flex justify-between items-start mb-3">
            <div className="space-y-2 flex-1">
              <Bone className="h-5 w-1/3" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="space-y-1">
              <Bone className="h-3 w-20" />
              <Bone className="h-6 w-28" />
            </div>
            <div className="space-y-1">
              <Bone className="h-3 w-8" />
              <Bone className="h-6 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Fallback generico
export default function SkeletonLoader() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="card space-y-2">
          <Bone className="h-4 w-2/5" />
          <Bone className="h-4 w-3/4" />
          <Bone className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
