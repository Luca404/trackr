import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
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
  const { userProfiles, activeProfile, switchProfile, createUserProfile, updateUserProfile, deleteUserProfile } = useData();
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(getTheme);
  const [currentLang, setCurrentLang] = useState<string>(() => {
    const l = i18n.language?.slice(0, 2);
    return ['it', 'es'].includes(l) ? l : 'en';
  });

  // Password
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Profili
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      setPasswordMsg({ type: 'error', text: t('settings.errorPasswordMismatch') });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: t('settings.errorPasswordTooShort') });
      return;
    }
    setPasswordLoading(true);
    setPasswordMsg(null);
    try {
      // Verifica la password attuale
      const email = user?.name ?? '';
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) {
        setPasswordMsg({ type: 'error', text: t('settings.errorCurrentPassword') });
        setPasswordLoading(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordMsg({ type: 'success', text: t('settings.successPasswordChanged') });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
    } catch (err: any) {
      setPasswordMsg({ type: 'error', text: err.message || t('settings.errorPasswordChange') });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveProfileName = async (id: string) => {
    const name = editingProfileName.trim();
    if (!name) return;
    setProfileLoading(true);
    try {
      await updateUserProfile(id, name);
      setEditingProfileId(null);
    } catch {
      setProfileMsg({ type: 'error', text: t('settings.errorProfileSave') });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleAddProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    setProfileLoading(true);
    try {
      await createUserProfile(name);
      setNewProfileName('');
      setShowAddProfile(false);
    } catch {
      setProfileMsg({ type: 'error', text: t('settings.errorProfileSave') });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (userProfiles.length <= 1) return;
    setProfileLoading(true);
    try {
      if (activeProfile?.id === id) {
        const other = userProfiles.find(p => p.id !== id)!;
        await switchProfile(other);
      }
      await deleteUserProfile(id);
    } catch {
      setProfileMsg({ type: 'error', text: t('settings.errorProfileDelete') });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      await apiService.exportData();
      setExportMessage({ type: 'success', text: t('settings.successExported') });
    } catch {
      setExportMessage({ type: 'error', text: t('settings.errorExporting') });
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

        {/* Profili */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.profiles')}</h2>

          {profileMsg && (
            <div className={`mb-3 text-sm px-3 py-2 rounded-lg ${profileMsg.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
              {profileMsg.text}
            </div>
          )}

          <div className="space-y-2">
            {userProfiles.map(profile => (
              <div key={profile.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-colors ${activeProfile?.id === profile.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                {editingProfileId === profile.id ? (
                  <input
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    value={editingProfileName}
                    onChange={e => setEditingProfileName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveProfileName(profile.id); if (e.key === 'Escape') setEditingProfileId(null); }}
                    autoFocus
                  />
                ) : (
                  <button
                    className="flex-1 text-left text-sm font-medium text-gray-800 dark:text-gray-100"
                    onClick={() => { if (activeProfile?.id !== profile.id) switchProfile(profile); }}
                  >
                    {profile.name}
                    {activeProfile?.id === profile.id && <span className="ml-2 text-xs text-primary-500 font-normal">{t('settings.activeProfile')}</span>}
                  </button>
                )}

                {editingProfileId === profile.id ? (
                  <div className="flex gap-1">
                    <button onClick={() => setEditingProfileId(null)} className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{t('common.cancel')}</button>
                    <button onClick={() => handleSaveProfileName(profile.id)} disabled={profileLoading} className="text-xs px-2 py-1 rounded bg-primary-500 text-white">{t('common.save')}</button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditingProfileId(profile.id); setEditingProfileName(profile.name); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" />
                      </svg>
                    </button>
                    {userProfiles.length > 1 && (
                      <button
                        onClick={() => handleDeleteProfile(profile.id)}
                        disabled={profileLoading}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Aggiungi profilo */}
            {showAddProfile ? (
              <div className="flex flex-col gap-2 mt-1">
                <input
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t('settings.profileNamePlaceholder')}
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddProfile(); if (e.key === 'Escape') setShowAddProfile(false); }}
                  autoFocus
                />
                <div className="flex gap-2">
                <button onClick={() => setShowAddProfile(false)} className="btn-secondary text-sm flex-1">{t('common.cancel')}</button>
                <button onClick={handleAddProfile} disabled={profileLoading || !newProfileName.trim()} className="btn-primary text-sm flex-1">{t('common.add')}</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddProfile(true)}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('settings.addProfile')}
              </button>
            )}
          </div>
        </section>

        {/* Account */}
        <section className="card">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('settings.account')}</h2>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-lg font-bold text-primary-600 dark:text-primary-400 shrink-0">
              {(user?.name?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">{user?.name || 'Utente'}</div>
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
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('settings.currentPassword')}</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="input-field"
                    placeholder={t('settings.passwordPlaceholder')}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('settings.newPassword')}</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input-field"
                    placeholder={t('settings.passwordPlaceholder')}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('settings.confirmPassword')}</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="input-field"
                    placeholder={t('settings.passwordPlaceholder')}
                    autoComplete="new-password"
                    required
                  />
                </div>
                {passwordMsg && (
                  <div className={`text-sm px-3 py-2 rounded-lg ${passwordMsg.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                    {passwordMsg.text}
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowChangePassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMsg(null); }} className="flex-1 btn-secondary text-sm py-2">
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
            <div className="grid grid-cols-3 gap-2">
              {([
                { code: 'en', flag: '🇬🇧', label: 'English' },
                { code: 'it', flag: '🇮🇹', label: 'Italiano' },
                { code: 'es', flag: '🇪🇸', label: 'Español' },
              ] as const).map(({ code, flag, label }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleLanguageChange(code)}
                  className={`py-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 border-2 transition-colors ${
                    currentLang === code
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <span className="text-xl">{flag}</span>
                  <span>{label}</span>
                </button>
              ))}
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
