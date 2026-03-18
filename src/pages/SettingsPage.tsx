import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function SettingsPage() {
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { logout } = useAuth();
  const user = apiService.getCurrentUser();

  const handleExport = async () => {
    try {
      await apiService.exportData();
      setExportMessage({ type: 'success', text: 'Backup esportato con successo!' });
    } catch (error) {
      setExportMessage({ type: 'error', text: 'Errore durante l\'esportazione' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">Impostazioni</h1>

        {/* Info utente */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Profilo</h2>
          <div className="space-y-2">
            <p className="text-gray-700 dark:text-gray-300">
              <span className="font-medium">Account:</span> {user?.name || 'Utente'}
            </p>
          </div>
        </div>

        {/* Backup locale JSON */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Backup</h2>
          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            Esporta JSON
          </button>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            Scarica un file JSON con tutti i tuoi dati
          </p>
          {exportMessage && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${
              exportMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
            }`}>
              {exportMessage.text}
            </div>
          )}
        </div>

        {/* Info PWA */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Installazione App</h2>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <p>Questa è una Progressive Web App (PWA). Puoi installarla sul tuo dispositivo:</p>
            <ul className="list-disc list-inside space-y-2 ml-4">
              <li><span className="font-medium">Android:</span> Tocca i 3 puntini → "Aggiungi a schermata Home"</li>
              <li><span className="font-medium">iOS:</span> Tocca "Condividi" → "Aggiungi a Home"</li>
              <li><span className="font-medium">Desktop:</span> Icona di installazione nella barra degli indirizzi</li>
            </ul>
          </div>
        </div>

        {/* Logout */}
        <div className="mt-8">
          <button
            onClick={logout}
            className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            Esci
          </button>
        </div>
      </div>
    </div>
  );
}
