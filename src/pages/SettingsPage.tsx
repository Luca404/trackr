import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/common/Modal';
import KakeboImport from '../components/KakeboImport';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useSettings } from '../contexts/SettingsContext';

function getTheme(): 'dark' | 'light' | 'system' {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'system';
}

function applyTheme(theme: 'dark' | 'light' | 'system') {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  } else {
    localStorage.removeItem('theme');
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const { numberFormat, setNumberFormat } = useSettings();
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(getTheme);
  const [currentLang, setCurrentLang] = useState<string>(localStorage.getItem('lang') || 'en');

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showKakeboImport, setShowKakeboImport] = useState(false);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const handleThemeChange = (t: 'dark' | 'light' | 'system') => {
    setTheme(t);
    applyTheme(t);
  };

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
    setCurrentLang(lang);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Le password non coincidono' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'La password deve avere almeno 6 caratteri' });
      return;
    }
    setPasswordLoading(true);
    setPasswordMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg({ type: 'success', text: 'Password aggiornata con successo' });
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || 'Errore durante il cambio password' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      await apiService.exportData();
      setExportMessage({ type: 'success', text: 'Backup esportato con successo!' });
    } catch {
      setExportMessage({ type: 'error', text: 'Errore durante l\'esportazione' });
    }
  };

  const themeOptions: { value: 'light' | 'dark' | 'system'; labelKey: string; icon: string }[] = [
    { value: 'light', labelKey: 'settings.themeLight', icon: '☀️' },
    { value: 'system', labelKey: 'settings.themeSystem', icon: '⚙️' },
    { value: 'dark', labelKey: 'settings.themeDark', icon: '🌙' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header con back button */}
      <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.title')}</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">

        {/* Profilo */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.profile')}</h2>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xl font-bold text-primary-600 dark:text-primary-400 shrink-0">
              {(user?.name?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{user?.name || 'Utente'}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.activeAccount')}</div>
            </div>
          </div>

          <div className="space-y-2">
            {/* Cambia password */}
            {!showChangePassword ? (
              <button
                onClick={() => { setShowChangePassword(true); setPasswordMsg(null); }}
                className="w-full text-left px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 text-sm font-medium flex items-center justify-between"
              >
                <span>{t('settings.changePassword')}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('settings.newPassword')}</div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="input"
                  placeholder={t('settings.passwordPlaceholder')}
                  autoComplete="new-password"
                  required
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input"
                  placeholder={t('settings.confirmPassword')}
                  autoComplete="new-password"
                  required
                />
                {passwordMsg && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${passwordMsg.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                    {passwordMsg.text}
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowChangePassword(false)} className="flex-1 btn-secondary text-sm py-2">
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className="flex-1 btn-primary text-sm py-2" disabled={passwordLoading}>
                    {passwordLoading ? '...' : t('common.save')}
                  </button>
                </div>
              </form>
            )}

            {/* Logout */}
            <button
              onClick={logout}
              className="w-full text-left px-4 py-3 rounded-lg text-red-600 dark:text-red-400 text-sm font-medium flex items-center gap-3 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('settings.logout')}
            </button>
          </div>
        </section>

        {/* Aspetto */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.appearance')}</h2>

          {/* Tema */}
          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('settings.theme')}</div>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleThemeChange(opt.value)}
                  className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                    theme === opt.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <span>{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Lingua */}
          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('settings.language')}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                  currentLang === 'en'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="text-xl">🇬🇧</span>
                <span>English</span>
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('it')}
                className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                  currentLang === 'it'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="text-xl">🇮🇹</span>
                <span>Italiano</span>
              </button>
            </div>
          </div>

          {/* Formato numeri */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('settings.numberFormat')}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNumberFormat('dot')}
                className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                  numberFormat === 'dot'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="font-mono text-base">1,234.56</span>
              </button>
              <button
                type="button"
                onClick={() => setNumberFormat('comma')}
                className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                  numberFormat === 'comma'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span className="font-mono text-base">1.234,56</span>
              </button>
            </div>
          </div>
        </section>

        {/* Import */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.import')}</h2>
          <button
            onClick={() => setShowKakeboImport(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="text-lg">📒</span>
            <div className="text-left">
              <div>{t('settings.importKakebo')}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 font-normal">{t('settings.importKakeboDesc')}</div>
            </div>
            <svg className="w-4 h-4 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </section>

        {/* Backup */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.backup')}</h2>
          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium text-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            {t('settings.exportJson')}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
            {t('settings.exportDesc')}
          </p>
          {exportMessage && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${
              exportMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            }`}>
              {exportMessage.text}
            </div>
          )}
        </section>

        {/* Installazione */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('settings.install')}</h2>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex items-start gap-2">
              <span className="shrink-0">🤖</span>
              <span><strong>{t('settings.installAndroid')}:</strong> {t('settings.installAndroidDesc')}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0">🍎</span>
              <span><strong>{t('settings.installIos')}:</strong> {t('settings.installIosDesc')}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="shrink-0">💻</span>
              <span><strong>{t('settings.installDesktop')}:</strong> {t('settings.installDesktopDesc')}</span>
            </div>
          </div>
        </section>

      </div>

      <Modal isOpen={showKakeboImport} onClose={() => setShowKakeboImport(false)} title={t('settings.importKakebo')} noBottomOffset>
        <KakeboImport onClose={() => setShowKakeboImport(false)} />
      </Modal>
    </div>
  );
}
