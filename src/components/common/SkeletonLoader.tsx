// Barra grigia generica
function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-gray-200 dark:bg-gray-700 rounded ${className}`} style={style} />;
}

import React from 'react';

// Valore numerico: mostra barra grigia mentre carica
export function SkeletonValue({ className }: { className?: string }) {
  return <Bone className={`h-7 w-28 inline-block ${className ?? ''}`} />;
}

// Riga transazione — stessa struttura di TransactionsPage
export function SkeletonTransactionRow() {
  return (
    <div className="card flex items-center justify-between animate-pulse">
      <div className="flex items-center gap-3 flex-1">
        <Bone className="w-8 h-8 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Bone className="h-4 w-2/5" />
          <Bone className="h-3 w-3/5" />
        </div>
      </div>
      <div className="ml-4 flex flex-col items-end space-y-2">
        <Bone className="h-3 w-16" />
        <Bone className="h-5 w-20" />
        <Bone className="h-3 w-10" />
      </div>
    </div>
  );
}

// Card conto — stessa struttura di AccountsPage
export function SkeletonAccountCard() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <Bone className="w-10 h-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-4 w-1/2" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Bone className="h-6 w-24" />
          <Bone className="w-8 h-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// Tile categoria — stessa struttura di CategoriesPage
export function SkeletonCategoryTile() {
  return (
    <div
      className="flex flex-col items-center p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse"
      style={{ minHeight: '7.75rem' }}
    >
      <Bone className="w-9 h-9 rounded-full mb-2" />
      <Bone className="h-3 w-3/4 mb-2" />
      <Bone className="h-4 w-1/2 mb-1" />
      <Bone className="h-3 w-1/3" />
    </div>
  );
}

// Card portafoglio — stessa struttura di PortfoliosPage
export function SkeletonPortfolioCard() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 space-y-2">
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
  );
}

// Riga transazione recente (Dashboard) — struttura più compatta
export function SkeletonRecentTransaction() {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg animate-pulse">
      <div className="flex-1 space-y-2">
        <Bone className="h-4 w-1/3" />
        <Bone className="h-3 w-1/4" />
        <Bone className="h-3 w-16 mt-1" />
      </div>
      <Bone className="h-6 w-24" />
    </div>
  );
}

export default function SkeletonLoader() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="card space-y-2">
          <Bone className="h-4 w-2/5" />
          <Bone className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
