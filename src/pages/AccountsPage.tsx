import { useState } from 'react';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import LoadingSpinner from '../components/common/LoadingSpinner';
import type { Account, AccountFormData } from '../types';

const ACCOUNT_ICONS = ['💳', '🏦', '💰', '💵', '💶', '💷', '💴', '🪙', '💸', '🏧', '📱', '💎'];

export default function AccountsPage() {
  const { accounts, isLoading, addAccount, updateAccount: updateAccountCache, deleteAccount: deleteAccountCache, refreshAccounts } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState<AccountFormData>({
    name: '',
    icon: '💳',
    initial_balance: 0,
    is_favorite: false,
  });
  const [balanceInput, setBalanceInput] = useState<string>('0');
  const [showNameError, setShowNameError] = useState(false);
  const [isBalanceFresh, setIsBalanceFresh] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [transactionCount, setTransactionCount] = useState<number>(0);

  const handleOpenModal = (account?: Account) => {
    if (account) {
      setIsEditMode(true);
      setSelectedAccount(account);
      setFormData({
        name: account.name,
        icon: account.icon,
        initial_balance: account.initial_balance,
        is_favorite: account.is_favorite || false,
      });
      // In modalità modifica, mostra il saldo corrente
      const currentBalance = account.current_balance ?? account.initial_balance;
      setBalanceInput(currentBalance.toString());
    } else {
      setIsEditMode(false);
      setSelectedAccount(null);
      setFormData({
        name: '',
        icon: '💳',
        initial_balance: 0,
        is_favorite: false,
      });
      setBalanceInput('0');
    }
    setShowNameError(false);
    setIsBalanceFresh(true);
    setDeleteError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedAccount(null);
    setIsEditMode(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Valida il nome
    if (formData.name.trim() === '') {
      setShowNameError(true);
      return;
    }

    const balanceValue = parseFloat(balanceInput) || 0;

    // Prepara i dati da inviare
    const finalFormData = isEditMode && selectedAccount
      ? {
          ...formData,
          // current_balance non è una colonna DB: è initial_balance + Σtransazioni.
          // Per ottenere il saldo corrente desiderato, ricalcola initial_balance di conseguenza.
          initial_balance: balanceValue - ((selectedAccount.current_balance ?? selectedAccount.initial_balance) - selectedAccount.initial_balance),
        }
      : {
          ...formData,
          initial_balance: balanceValue,
        };

    try {
      if (isEditMode && selectedAccount) {
        const updatedAccount = await apiService.updateAccount(selectedAccount.id, finalFormData);
        updateAccountCache(updatedAccount);
      } else {
        const newAccount = await apiService.createAccount(finalFormData);
        addAccount(newAccount);
      }
      handleCloseModal();
    } catch (error) {
      console.error('Errore salvataggio conto:', error);
      alert('Errore durante il salvataggio del conto');
    }
  };

  const handleNumberClick = (num: string) => {
    // Se è il primo click dopo l'apertura del modal, sostituisci il valore
    if (isBalanceFresh) {
      setBalanceInput(num);
      setIsBalanceFresh(false);
    } else if (balanceInput === '0') {
      setBalanceInput(num);
    } else {
      setBalanceInput(balanceInput + num);
    }
  };

  const handleBackspace = () => {
    setIsBalanceFresh(false);
    if (balanceInput.length > 1) {
      setBalanceInput(balanceInput.slice(0, -1));
    } else {
      setBalanceInput('0');
    }
  };

  const handleToggleSign = () => {
    setIsBalanceFresh(false);
    if (balanceInput === '0') return;

    if (balanceInput.startsWith('-')) {
      setBalanceInput(balanceInput.substring(1));
    } else {
      setBalanceInput('-' + balanceInput);
    }
  };

  const handleDelete = async () => {
    if (!selectedAccount) return;

    try {
      await apiService.deleteAccount(selectedAccount.id);
      deleteAccountCache(selectedAccount.id);
      setShowDeleteConfirm(false);
      handleCloseModal();
    } catch (error: any) {
      console.error('Errore eliminazione conto:', error);

      // Controlla se è un errore 400 con transazioni associate
      if (error.response?.status === 400 && error.response?.data?.detail) {
        const detail = error.response.data.detail;
        // Estrai il numero di transazioni dal messaggio di errore
        const match = detail.match(/(\d+) transaction/);
        const count = match ? parseInt(match[1]) : 0;
        setTransactionCount(count);
        setDeleteError(detail);
      } else {
        setDeleteError('Errore durante l\'eliminazione del conto');
      }
    }
  };

  const handleToggleFavorite = async (account: Account, e: React.MouseEvent) => {
    e.stopPropagation(); // Previene l'apertura del modal

    // Se è già preferito, non fare nulla (almeno un preferito deve esserci sempre)
    if (account.is_favorite) return;

    // Trova i conti che erano preferiti (da aggiornare nel DB)
    const prevFavorites = accounts.filter(acc => acc.id !== account.id && acc.is_favorite);

    // Aggiorna la cache: rimuovi preferito dagli altri e imposta questo
    prevFavorites.forEach(acc => updateAccountCache({ ...acc, is_favorite: false }));
    updateAccountCache({ ...account, is_favorite: true });

    try {
      // Persisti nel DB: sia la rimozione dai vecchi preferiti che il nuovo
      await Promise.all([
        ...prevFavorites.map(acc => apiService.updateAccount(acc.id, { is_favorite: false })),
        apiService.updateAccount(account.id, { is_favorite: true }),
      ]);
    } catch (error) {
      console.error('Errore aggiornamento preferito:', error);
      await refreshAccounts();
    }
  };

  const formatAmountDisplay = (value: string): string => {
    const negative = value.startsWith('-');
    const abs = negative ? value.slice(1) : value;
    const [intStr, decStr] = abs.split('.');
    const intFormatted = (parseInt(intStr) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const result = decStr !== undefined ? `${intFormatted},${decStr}` : intFormatted;
    return negative ? `-${result}` : result;
  };

  const formatCurrency = (amount: number) => {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    const [intStr, decStr] = abs.toFixed(2).split('.');
    const intFormatted = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}€ ${intFormatted},${decStr}`;
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const totalLiquidity = accounts.reduce((sum, acc) => sum + (acc.current_balance ?? acc.initial_balance), 0);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Totale liquidità */}
        {accounts.length > 0 && (
          <div className="card text-center py-6">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Liquidità totale</div>
            <div className={`text-4xl font-bold ${totalLiquidity >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(totalLiquidity)}
            </div>
          </div>
        )}

        {/* Lista conti */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {accounts.map((account) => (
              <div
                key={account.id}
                className="card hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => handleOpenModal(account)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="text-4xl">{account.icon}</div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {account.name}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`text-lg font-bold ${
                        (account.current_balance ?? account.initial_balance) >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatCurrency(account.current_balance ?? account.initial_balance)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleToggleFavorite(account, e)}
                      className="text-2xl transition-colors"
                    >
                      <span className={account.is_favorite ? 'text-yellow-400 text-3xl' : 'text-gray-300 dark:text-gray-600 text-2xl'}>★</span>
                    </button>
                  </div>
                </div>
              </div>
          ))}
          {/* Aggiungi nuovo conto */}
          <div
            className="card flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none md:col-span-2"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            onClick={() => handleOpenModal()}
          >
            <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
          </div>
        </div>

        {/* Modal per creare/modificare conto */}
        <Modal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          title={isEditMode ? 'Modifica Conto' : 'Nuovo Conto'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Nome
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (showNameError && e.target.value.trim() !== '') {
                    setShowNameError(false);
                  }
                }}
                className={`w-full px-4 py-2 rounded-lg border ${
                  showNameError
                    ? 'border-red-500 dark:border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                } bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent`}
                placeholder="es. Conto Principale"
                required
              />
            </div>

            {/* Icona */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Icona
              </label>
              <div className="grid grid-cols-6 gap-2">
                {ACCOUNT_ICONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon })}
                    className={`p-3 text-2xl rounded-lg border-2 transition-colors ${
                      formData.icon === icon
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Saldo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {isEditMode ? 'Saldo Corrente' : 'Saldo Iniziale'}
              </label>
              {/* Display dell'importo */}
              <div className="text-center mb-4">
                <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  € {formatAmountDisplay(balanceInput)}
                </div>
              </div>

              {/* Tastierino numerico con OK */}
              <div className="flex gap-2">
                {/* Griglia numeri 3x4 (sinistra) */}
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {/* Numeri 1-9 */}
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleNumberClick(num.toString())}
                      className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                      {num}
                    </button>
                  ))}
                  {/* +/- Toggle */}
                  <button
                    type="button"
                    onClick={handleToggleSign}
                    className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    +/−
                  </button>
                  {/* Zero */}
                  <button
                    type="button"
                    onClick={() => handleNumberClick('0')}
                    className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    0
                  </button>
                  {/* Virgola */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsBalanceFresh(false);
                      if (!balanceInput.includes('.')) {
                        setBalanceInput(balanceInput + '.');
                      }
                    }}
                    className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    ,
                  </button>
                </div>

                {/* Colonna comandi (destra) */}
                <div className="flex flex-col gap-2">
                  {/* Backspace */}
                  <button
                    type="button"
                    onClick={handleBackspace}
                    className="h-14 w-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    ←
                  </button>
                  {/* OK button */}
                  <button
                    type="button"
                    onClick={() => handleSubmit()}
                    className="flex-1 w-14 text-2xl font-bold rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                  >
                    ✓
                  </button>
                  {/* Elimina (solo in edit mode) */}
                  {isEditMode && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="h-14 w-14 text-xl rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </Modal>

        {/* Dialog di conferma eliminazione */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => {
            setShowDeleteConfirm(false);
            setDeleteError(null);
          }}
          onConfirm={handleDelete}
          title={deleteError ? "Impossibile Eliminare" : "Elimina Conto"}
          message={
            deleteError
              ? `Non puoi eliminare il conto "${selectedAccount?.name}" perché ci ${transactionCount === 1 ? 'è' : 'sono'} ${transactionCount} transazion${transactionCount === 1 ? 'e' : 'i'} collegat${transactionCount === 1 ? 'a' : 'e'} a questo conto.`
              : `Sei sicuro di voler eliminare il conto "${selectedAccount?.name}"? Questa azione non può essere annullata.`
          }
          confirmText={deleteError ? "OK" : "Elimina"}
          cancelText={deleteError ? undefined : "Annulla"}
          isDestructive={!deleteError}
        />
      </div>
    </Layout>
  );
}
