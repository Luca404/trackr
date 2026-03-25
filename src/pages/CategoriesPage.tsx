import { useState, useMemo } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { SkeletonCategoryTile } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import PeriodSelector from '../components/common/PeriodSelector';
import DateRangePicker from '../components/common/DateRangePicker';
import { usePeriod } from '../hooks/usePeriod';
import type { CategoryWithStats, CategoryFormData, SubcategoryFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

type CategoryFilter = 'income' | 'expense' | 'investment';
type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

const ICON_GROUPS: { tKey: string; icons: string[] }[] = [
  { tKey: 'categories.groups.food',          icons: ['🍔', '🍕', '🍝', '🌮', '🍜', '🍛', '🍣', '🥗', '🍗', '🌭', '🍟', '🥙', '🌯', '🍲', '🥟'] },
  { tKey: 'categories.groups.breakfast',     icons: ['🥐', '🥖', '🍞', '🧀', '🥚', '🍳', '🥓'] },
  { tKey: 'categories.groups.sweetsSnacks',  icons: ['🍰', '🎂', '🍫', '🍭', '🍬', '🍩', '🍪', '🍦', '🍿', '🌰', '🥜'] },
  { tKey: 'categories.groups.fruitVeg',      icons: ['🍎', '🍊', '🍋', '🍇', '🍓', '🥝', '🥑', '🥕', '🌽', '🥦'] },
  { tKey: 'categories.groups.drinks',        icons: ['☕', '🍺', '🍷', '🥤', '🍵', '🧃', '🍹', '🍸', '🍻', '🥂', '🥃', '🍾'] },
  { tKey: 'categories.groups.transport',     icons: ['🚌', '🚆', '🚇', '🚕', '🚗', '🚙', '✈️', '🏍️', '🚲', '🛵', '⛽'] },
  { tKey: 'categories.groups.homeUtilities', icons: ['🏠', '🏡', '🔑', '💡', '⚡', '🔥', '🚿', '🛋️', '🪴', '🧹', '🧺'] },
  { tKey: 'categories.groups.health',        icons: ['🏥', '💊', '🩺', '💉', '🦷', '👓', '🧴', '💆', '🚑'] },
  { tKey: 'categories.groups.shopping',      icons: ['🛍️', '👕', '👗', '👠', '👟', '🧥', '👔', '👜', '🎒'] },
  { tKey: 'categories.groups.technology',    icons: ['📱', '💻', '🖥️', '📺', '🎧', '📡', '🌐', '💾'] },
  { tKey: 'categories.groups.entertainment', icons: ['🎬', '🎮', '🎵', '🎸', '🎭', '🎨', '🎤', '📚', '🎲', '🎯', '🎪'] },
  { tKey: 'categories.groups.sportFitness',  icons: ['🏋️', '⚽', '🏀', '🎾', '🏊', '🧘', '🏃', '🚴', '🥊', '⛷️', '🏂'] },
  { tKey: 'categories.groups.travel',        icons: ['🏖️', '🧳', '🏨', '🗺️', '🗼'] },
  { tKey: 'categories.groups.finance',       icons: ['💰', '💵', '💳', '🏦', '💸', '📈', '💶'] },
  { tKey: 'categories.groups.education',     icons: ['🎓', '✏️', '📖', '📝', '🖊️'] },
  { tKey: 'categories.groups.animalsNature', icons: ['🐶', '🐱', '🐾', '🌳', '🌿', '🌺'] },
  { tKey: 'categories.groups.beautyCare',    icons: ['💄', '💅', '💇', '💈', '🪒', '🧖'] },
  { tKey: 'categories.groups.smokingVices',  icons: ['🚬', '💨'] },
  { tKey: 'categories.groups.misc',          icons: ['🎁', '🎉', '🎀', '🤝', '🛡️', '🧾', '🏛️', '⚖️', '📸', '📌', '💼', '🔧', '🛠️', '🔒', '📞', '📻', '🎃'] },
];


const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#64748b',
];
const randomPresetColor = () => PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];

// Mappa parole chiave -> icone suggerite
// Ogni entry: array di keyword italiane/inglesi -> icone in ordine di rilevanza
const ICON_SUGGESTIONS: Array<[string[], string[]]> = [
  [['cibo', 'food', 'mangiare', 'spesa', 'alimentari', 'supermercato', 'mercato', 'spese'], ['🛍️', '🍔', '🍕', '🥗', '🍝', '🥦']],
  [['ristorante', 'pranzo', 'cena', 'trattoria', 'osteria', 'pizzeria'], ['🍕', '🍝', '🍗', '🌮', '🍣', '🥗']],
  [['bar', 'caffe', 'caffè', 'cornetto', 'colazione', 'brioche', 'cappuccino'], ['☕', '🥐', '🥖', '🍳']],
  [['pizza', 'pizzeria'], ['🍕']],
  [['pasta', 'spaghetti', 'ramen', 'noodle'], ['🍝', '🍜']],
  [['sushi', 'giapponese', 'cinese', 'asiatico'], ['🍣', '🥟', '🍜']],
  [['hamburger', 'burger', 'fast food', 'fastfood', 'mcdonald', 'kebab'], ['🍔', '🌭', '🍟']],
  [['birra', 'pub', 'aperitivo', 'aperitivi'], ['🍺', '🍻', '🥂']],
  [['vino', 'cantina', 'enoteca'], ['🍷', '🍾', '🥂']],
  [['cocktail', 'drink', 'bevanda', 'bevande'], ['🍹', '🍸', '🥃']],
  [['dolci', 'dessert', 'gelateria', 'gelato', 'pasticceria', 'torta', 'dolce'], ['🍰', '🎂', '🍦', '🍫', '🍩']],
  [['cioccolato', 'cacao'], ['🍫', '🍩']],
  [['frutta', 'verdura', 'ortaggi', 'mercato', 'biologico'], ['🍎', '🥦', '🥕', '🍇', '🥑']],
  [['benzina', 'carburante', 'gasolio', 'rifornimento', 'distributore'], ['⛽', '🚗']],
  [['auto', 'macchina', 'car', 'veicolo', 'automobile'], ['🚗', '🚙', '⛽']],
  [['moto', 'motocicletta', 'scooter'], ['🏍️', '🛵']],
  [['bici', 'bicicletta', 'ciclismo', 'monopattino'], ['🚲', '🛵']],
  [['treno', 'metro', 'metropolitana', 'atm', 'tram', 'bus', 'autobus', 'trasporto pubblico', 'abbonamento trasporti'], ['🚆', '🚇', '🚌']],
  [['taxi', 'uber', 'ncc', 'navetta'], ['🚕']],
  [['aereo', 'volo', 'aeroport'], ['✈️', '🏖️', '🧳']],
  [['vacanza', 'viaggio', 'viaggi', 'ferie', 'weekend', 'turismo', 'hotel', 'alloggio', 'airbnb', 'hostel'], ['🏖️', '🧳', '🏨', '🗺️', '✈️']],
  [['parcheggio', 'garage', 'autosilo', 'sosta'], ['🚗', '🔑']],
  [['pedaggio', 'autostrada', 'casello', 'telepass'], ['🚙', '🛣️']],
  [['affitto', 'mutuo', 'canone', 'rata'], ['🏠', '🔑', '🏦']],
  [['casa', 'home', 'immobiliare', 'condominio'], ['🏠', '🏡', '🔑']],
  [['luce', 'elettricità', 'corrente', 'enel', 'eni'], ['⚡', '💡']],
  [['gas', 'riscaldamento', 'caldaia'], ['🔥', '💡']],
  [['acqua', 'bolletta', 'bollette', 'utenze', 'utenza'], ['💡', '🚿', '⚡']],
  [['pulizie', 'pulizia', 'lavanderia', 'lavatrice', 'bucato', 'detersivi', 'cleaning'], ['🧹', '🧺', '🧼']],
  [['medico', 'dottore', 'visita', 'analisi', 'esami', 'clinica', 'ospedale'], ['🩺', '🏥', '💉']],
  [['farmacia', 'farmaco', 'medicina', 'medicinale', 'pillole', 'integratori'], ['💊', '🧴']],
  [['dentista', 'ortodontista', 'ortodonzia'], ['🦷']],
  [['oculista', 'ottico', 'occhiali', 'lenti'], ['👓']],
  [['palestra', 'gym', 'fitness', 'allenamento', 'crossfit', 'piscina'], ['🏋️', '🏊', '🧘', '🚴']],
  [['sport', 'calcio', 'basket', 'tennis', 'nuoto', 'corsa', 'running'], ['⚽', '🏀', '🎾', '🏃', '🏊']],
  [['yoga', 'meditazione', 'pilates'], ['🧘']],
  [['abbigliamento', 'vestiti', 'vestito', 'clothes', 'moda', 'fashion'], ['👕', '👗', '👔', '🧥']],
  [['scarpe', 'sneakers', 'stivali', 'calzature'], ['👟', '👠']],
  [['shopping', 'acquisti', 'negozio', 'shop'], ['🛍️', '👜']],
  [['telefono', 'smartphone', 'cellulare', 'ricarica'], ['📱', '☎️']],
  [['computer', 'pc', 'laptop', 'notebook', 'mac'], ['💻', '🖥️']],
  [['internet', 'wifi', 'fibra', 'adsl', 'connessione', 'web'], ['🌐', '📡']],
  [['streaming', 'netflix', 'prime', 'disney', 'hbo', 'youtube'], ['📺', '🎬', '💻']],
  [['spotify', 'music', 'musica', 'apple music', 'tidal'], ['🎵', '🎧']],
  [['abbonamento', 'abbonamenti', 'subscription', 'mensile', 'annuale'], ['💳', '📱', '💻']],
  [['giochi', 'videogiochi', 'gaming', 'game', 'console', 'playstation', 'xbox', 'nintendo', 'steam'], ['🎮', '🕹️']],
  [['cinema', 'film', 'movie'], ['🎬', '🎭']],
  [['teatro', 'concerto', 'spettacolo', 'evento', 'biglietto'], ['🎭', '🎤', '🎟️']],
  [['libri', 'libro', 'ebook', 'audible', 'kindle', 'fumetti'], ['📚', '📖']],
  [['scuola', 'università', 'corso', 'formazione', 'istruzione', 'master', 'lezioni', 'ripetizioni'], ['🎓', '✏️', '📝']],
  [['animali', 'cane', 'gatto', 'pet', 'veterinario', 'dog', 'cat', 'cucciolo'], ['🐶', '🐱', '🐾']],
  [['parrucchiere', 'barbiere', 'barber', 'taglio', 'capelli'], ['💈', '💇']],
  [['estetica', 'nail', 'unghie', 'manicure', 'pedicure'], ['💅', '💄']],
  [['spa', 'massaggio', 'benessere', 'beauty', 'bellezza'], ['🧖', '💆']],
  [['sigarette', 'sigaretta', 'tabacchi', 'tabaccheria', 'tabacco', 'sigaro', 'fumo'], ['🚬']],
  [['svapo', 'vaping', 'vape', 'sigaretta elettronica'], ['💨', '🚬']],
  [['alcol', 'alcolici', 'superalcolici', 'liquori'], ['🥃', '🍷', '🍺']],
  [['regali', 'regalo', 'gift', 'compleanno', 'natale', 'presente'], ['🎁', '🎉', '🎀']],
  [['feste', 'festa', 'party', 'anniversario', 'matrimonio', 'cerimonia'], ['🎉', '🎂', '🥂']],
  [['banca', 'bank', 'risparmio', 'investimento', 'investimenti', 'finanza', 'borsa'], ['🏦', '📈', '💰']],
  [['commissioni', 'spese bancarie', 'canone bancario'], ['🏦', '💳']],
  [['tasse', 'imposte', 'tributi', 'irpef', 'imu', 'bollo', 'f24', 'pagopa', 'fisco'], ['🏛️', '🧾', '⚖️']],
  [['assicurazione', 'polizza', 'rc auto', 'infortuni'], ['🛡️']],
  [['riparazione', 'manutenzione', 'meccanico', 'idraulico', 'elettricista', 'imbianchino'], ['🔧', '🛠️']],
  [['foto', 'fotografia', 'fotografo'], ['📸']],
  [['musica', 'strumento', 'chitarra', 'pianoforte', 'lezioni di musica'], ['🎸', '🎹', '🎵']],
  [['giardino', 'piante', 'fiori', 'orto', 'giardinaggio'], ['🪴', '🌿', '🌺']],
  [['lavoro', 'ufficio', 'business', 'professionale'], ['💼', '📊']],
  [['donazione', 'beneficenza', 'volontariato', 'charity'], ['🤝', '❤️']],
];

// Restituisce le icone suggerite per il nome dato (array vuoto = nessun suggerimento)
const getSuggestedIcons = (name: string): string[] => {
  if (!name || name.trim().length < 2) return [];

  const nameLower = name.toLowerCase().trim();
  const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 2);

  const matches: { icons: string[]; score: number }[] = [];

  for (const [keywords, icons] of ICON_SUGGESTIONS) {
    let bestScore = 0;

    for (const keyword of keywords) {
      const kw = keyword.toLowerCase();
      for (const word of nameWords) {
        let score = 0;
        if (word === kw)                               score = 100;
        else if (word.startsWith(kw))                  score = 85;
        else if (kw.startsWith(word))                  score = 75;
        else if (kw.includes(word) && word.length >= 3) score = 55;
        else if (word.includes(kw) && kw.length >= 3)  score = 50;
        bestScore = Math.max(bestScore, score);
      }
      if (kw.includes(' ')) {
        if (nameLower === kw)               bestScore = Math.max(bestScore, 100);
        else if (nameLower.startsWith(kw))  bestScore = Math.max(bestScore, 85);
        else if (kw.startsWith(nameLower))  bestScore = Math.max(bestScore, 75);
        else if (nameLower.includes(kw))    bestScore = Math.max(bestScore, 60);
      }
    }
    if (bestScore >= 50) matches.push({ icons, score: bestScore });
  }

  if (matches.length === 0) return [];
  matches.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  matches.forEach(m => m.icons.forEach(icon => seen.add(icon)));
  return Array.from(seen);
};

export default function CategoriesPage() {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const { categories: baseCategories, transactions: allTransactions, isLoading, addCategory, updateCategory: updateCategoryCache, deleteCategory: deleteCategoryCache, refreshTransactions } = useData();
  const [filter, setFilter] = useState<CategoryFilter>('expense');
  const [selectedCategory, setSelectedCategory] = useState<CategoryWithStats | null>(null);
  const [isSubcategoryModalOpen, setIsSubcategoryModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  // Period state - condiviso tra le pagine
  const { startDate, endDate, setPeriod } = usePeriod();

  // Calcola le statistiche localmente dalle transazioni filtrate per periodo
  const categories = useMemo(() => {
    // Filtra le transazioni per il periodo
    const filteredTransactions = allTransactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transactionDate >= startDate && transactionDate <= endDate;
    });

    // Crea una mappa per aggregare le statistiche per categoria
    const categoryStats = new Map<number, CategoryWithStats>();

    // Inizializza le categorie base
    baseCategories.forEach(category => {
      categoryStats.set(category.id, {
        ...category,
        total_amount: 0,
        transaction_count: 0,
        subcategories: category.subcategories?.map(sub => ({
          ...sub,
          total_amount: 0,
          transaction_count: 0,
        })) || [],
      });
    });

    // Aggrega le transazioni
    filteredTransactions.forEach(transaction => {
      const category = baseCategories.find(c => c.name === transaction.category);
      if (!category) return;

      // Filtra solo le transazioni che corrispondono al tipo della categoria
      // Se la categoria ha category_type null, conta tutte le transazioni
      if (category.category_type && transaction.type !== category.category_type) {
        return;
      }

      const stats = categoryStats.get(category.id);
      if (!stats) return;

      // Aggiorna totale categoria
      stats.total_amount += Math.abs(transaction.amount);
      stats.transaction_count += 1;

      // Aggiorna sottocategoria se presente
      if (transaction.subcategory && stats.subcategories) {
        const subcat = stats.subcategories.find(s => s.name === transaction.subcategory);
        if (subcat) {
          subcat.total_amount = (subcat.total_amount || 0) + Math.abs(transaction.amount);
          subcat.transaction_count = (subcat.transaction_count || 0) + 1;
        }
      }
    });

    return Array.from(categoryStats.values());
  }, [baseCategories, allTransactions, startDate, endDate]);

  const [categoryFormData, setCategoryFormData] = useState<CategoryFormData>({
    name: '',
    icon: '📌',
    color: randomPresetColor(),
    category_type: 'expense',
  });

  const [subcategoryFormData, setSubcategoryFormData] = useState<SubcategoryFormData>({
    name: '',
  });

  const [showSubcategoryForm, setShowSubcategoryForm] = useState(false);
  const [editingSubcategoryId, setEditingSubcategoryId] = useState<number | null>(null);
  const [editingSubcategoryName, setEditingSubcategoryName] = useState('');

  // Confirm dialog states
  const [isDeleteCategoryDialogOpen, setIsDeleteCategoryDialogOpen] = useState(false);
  const [isDeleteSubcategoryDialogOpen, setIsDeleteSubcategoryDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<number | null>(null);
  const [subcategoryToDelete, setSubcategoryToDelete] = useState<number | null>(null);

  const handlePeriodChange = (start: Date, end: Date, type: PeriodType) => {
    setPeriod(start, end, type);
  };

  const handleCustomPeriodConfirm = (start: Date, end: Date) => {
    setPeriod(start, end, 'custom');
  };

  const handleCategoryClick = (category: CategoryWithStats) => {
    setSelectedCategory(category);
    setIsSubcategoryModalOpen(true);
  };

  const handleEditCategory = (e: React.MouseEvent, category: CategoryWithStats) => {
    e.stopPropagation();
    setSelectedCategory(category);
    setIsEditMode(true);
    setCategoryFormData({
      name: category.name,
      icon: category.icon,
      color: category.color || randomPresetColor(),
      category_type: category.category_type,
    });
    setIsCategoryModalOpen(true);
  };

  const handleDeleteCategory = (e: React.MouseEvent, categoryId: number) => {
    e.stopPropagation();
    setCategoryToDelete(categoryId);
    setIsDeleteCategoryDialogOpen(true);
  };

  const confirmDeleteCategory = async () => {
    if (categoryToDelete !== null) {
      try {
        await apiService.deleteCategory(categoryToDelete);
        deleteCategoryCache(categoryToDelete);
        setIsCategoryModalOpen(false);
        setIsSubcategoryModalOpen(false);
      } catch (error) {
        console.error('Errore eliminazione categoria:', error);
      } finally {
        setCategoryToDelete(null);
      }
    }
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditMode && selectedCategory) {
        const oldName = selectedCategory.name;
        const updated = await apiService.updateCategory(selectedCategory.id, categoryFormData);
        updateCategoryCache(updated);
        setSelectedCategory(prev => prev ? { ...prev, name: updated.name, icon: updated.icon, category_type: updated.category_type } : prev);
        if (updated.name !== oldName) {
          await supabase.from('transactions').update({ category: updated.name }).eq('category', oldName);
          await refreshTransactions();
        }
      } else {
        const newCategory = await apiService.createCategory(categoryFormData);
        addCategory(newCategory);
      }
      setIsCategoryModalOpen(false);
      setIsEditMode(false);
    } catch (error) {
      console.error('Errore salvataggio categoria:', error);
    }
  };

  const handleSubcategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) return;

    try {
      const newSubcategory = await apiService.createSubcategory(selectedCategory.id, subcategoryFormData);

      // Aggiorna la categoria nella cache con la nuova sottocategoria
      const categoryFromCache = baseCategories.find(c => c.id === selectedCategory.id);
      if (categoryFromCache) {
        const updatedCategory = {
          ...categoryFromCache,
          subcategories: [...(categoryFromCache.subcategories || []), newSubcategory]
        };
        updateCategoryCache(updatedCategory);
      }

      setSubcategoryFormData({ name: '' });
      setShowSubcategoryForm(false);
      // Aggiorna selectedCategory direttamente (non aspettare il ricalcolo useMemo)
      setSelectedCategory(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          subcategories: [...(prev.subcategories || []), { ...newSubcategory, total_amount: 0, transaction_count: 0 }],
        };
      });
    } catch (error) {
      console.error('Errore creazione sottocategoria:', error);
    }
  };

  const handleSubcategoryRename = async (subcategoryId: number) => {
    const trimmed = editingSubcategoryName.trim();
    if (!trimmed || !selectedCategory) { setEditingSubcategoryId(null); return; }
    const original = selectedCategory.subcategories?.find(s => s.id === subcategoryId)?.name;
    if (trimmed === original) { setEditingSubcategoryId(null); return; }
    try {
      const updated = await apiService.updateSubcategory(subcategoryId, trimmed);
      const updateSubs = (subs: any[]) => subs.map(s => s.id === subcategoryId ? { ...s, name: updated.name } : s);
      const categoryFromCache = baseCategories.find(c => c.id === selectedCategory.id);
      if (categoryFromCache) updateCategoryCache({ ...categoryFromCache, subcategories: updateSubs(categoryFromCache.subcategories || []) });
      setSelectedCategory(prev => prev ? { ...prev, subcategories: updateSubs(prev.subcategories || []) } : prev);
      await supabase.from('transactions')
        .update({ subcategory: updated.name })
        .eq('subcategory', original!)
        .eq('category', selectedCategory.name);
      await refreshTransactions();
    } catch (e) { console.error(e); }
    setEditingSubcategoryId(null);
  };

  const handleDeleteSubcategory = (subcategoryId: number) => {
    setSubcategoryToDelete(subcategoryId);
    setIsDeleteSubcategoryDialogOpen(true);
  };

  const confirmDeleteSubcategory = async () => {
    if (!selectedCategory || subcategoryToDelete === null) return;
    try {
      await apiService.deleteSubcategory(selectedCategory.id, subcategoryToDelete);

      // Aggiorna la categoria nella cache rimuovendo la sottocategoria
      const categoryFromCache = baseCategories.find(c => c.id === selectedCategory.id);
      if (categoryFromCache) {
        const updatedCategory = {
          ...categoryFromCache,
          subcategories: (categoryFromCache.subcategories || []).filter(s => s.id !== subcategoryToDelete)
        };
        updateCategoryCache(updatedCategory);
      }

      // Aggiorna selectedCategory direttamente
      setSelectedCategory(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          subcategories: (prev.subcategories || []).filter(s => s.id !== subcategoryToDelete),
        };
      });
    } catch (error) {
      console.error('Errore eliminazione sottocategoria:', error);
    } finally {
      setSubcategoryToDelete(null);
    }
  };


  const filteredCategories = categories
    .filter(category => category.category_type === filter || (!category.category_type && filter === 'expense'))
    .sort((a, b) => b.total_amount - a.total_amount);
  const skeletonCount = useSkeletonCount(`categories:${filter}`, filteredCategories.length, isLoading, 9);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Period Selector */}
        <PeriodSelector
          startDate={startDate}
          endDate={endDate}
          onPeriodChange={handlePeriodChange}
          onCustomClick={() => setIsDatePickerOpen(true)}
        />

        {/* Filtri tipologia */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('expense')}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              filter === 'expense'
                ? 'bg-red-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            💸 Uscite
          </button>
          <button
            onClick={() => setFilter('income')}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              filter === 'income'
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            💰 Entrate
          </button>
          <button
            onClick={() => setFilter('investment')}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
              filter === 'investment'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            📈 Investimenti
          </button>
        </div>

        {/* Grid categorie compatto */}
        <div className="grid grid-cols-3 gap-3">
          {isLoading
            ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCategoryTile key={i} />)
            : filteredCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => handleCategoryClick(category)}
                className="flex flex-col items-center p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 hover:shadow-md transition-all"
              >
                <div className="relative">
                  <div className="text-3xl mb-1">{category.icon}</div>
                  {category.color && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white dark:border-gray-800" style={{ backgroundColor: category.color }} />
                  )}
                </div>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 text-center line-clamp-1 w-full">
                  {category.name}
                </div>
                <div className={`text-sm font-bold mt-1 ${
                  filter === 'expense'
                    ? 'text-red-600 dark:text-red-400'
                    : filter === 'income'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}>
                  {formatCurrency(Math.abs(category.total_amount))}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {category.transaction_count} trans.
                </div>
              </button>
          ))}
          {/* Aggiungi nuova categoria */}
          {!isLoading && <button
            onClick={() => {
              setIsEditMode(false);
              setCategoryFormData({ name: '', icon: '📌', color: randomPresetColor(), category_type: filter });
              setIsCategoryModalOpen(true);
            }}
            className="flex flex-col items-center justify-center p-3 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 outline-none focus:outline-none select-none min-h-[7.75rem]"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
          </button>}
        </div>

        {/* Modal sottocategorie */}
        <Modal
          isOpen={isSubcategoryModalOpen}
          onClose={() => {
            setIsSubcategoryModalOpen(false);
            setShowSubcategoryForm(false);
            setSubcategoryFormData({ name: '' });
            setEditingSubcategoryId(null);
          }}
          title={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{selectedCategory?.icon}</span>
                <span>{selectedCategory?.name}</span>
              </div>
              <button
                onClick={(e) => selectedCategory && handleEditCategory(e, selectedCategory)}
                className="text-gray-600 dark:text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 text-xl"
              >
                &nbsp;&nbsp;⚙️
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Lista sottocategorie */}
            {selectedCategory && selectedCategory.subcategories && selectedCategory.subcategories.length > 0 && (() => {
              const baseColors = ['#ef4444','#fb923c','#fbbf24','#84cc16','#10b981','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#d946ef','#ec4899','#be123c'];
              const sortedCatsOfType = [...categories]
                .filter(c => c.category_type === selectedCategory.category_type)
                .sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
              const catColorIdx = sortedCatsOfType.findIndex(c => c.id === selectedCategory.id);
              const catColor = selectedCategory.color || baseColors[Math.max(0, catColorIdx) % baseColors.length];
              const catTotal = selectedCategory.total_amount || 0;
              return (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Sottocategorie
                  </h4>
                  <div className="space-y-3">
                    {selectedCategory.subcategories.map((sub) => {
                      const subAmount = sub.total_amount || 0;
                      const pct = catTotal > 0 ? (subAmount / catTotal) * 100 : 0;
                      return (
                        <div key={sub.id}>
                          <div className="flex items-center justify-between mb-1">
                            {editingSubcategoryId === sub.id ? (
                              <input
                                autoFocus
                                className="flex-1 text-sm bg-transparent border-b border-primary-500 outline-none text-gray-900 dark:text-gray-100 mr-2"
                                value={editingSubcategoryName}
                                onChange={e => setEditingSubcategoryName(e.target.value)}
                                onBlur={() => setEditingSubcategoryId(null)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); handleSubcategoryRename(sub.id); }
                                  if (e.key === 'Escape') setEditingSubcategoryId(null);
                                }}
                              />
                            ) : (
                              <span
                                className="text-sm text-gray-900 dark:text-gray-100 cursor-pointer flex-1 min-w-0 truncate"
                                onClick={() => { setEditingSubcategoryId(sub.id); setEditingSubcategoryName(sub.name); }}
                              >
                                {sub.name}
                              </span>
                            )}
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {subAmount > 0 && (
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  {formatCurrency(subAmount)}
                                </span>
                              )}
                              <button
                                onClick={() => handleDeleteSubcategory(sub.id)}
                                className="text-red-400 hover:text-red-600 text-sm"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          <div className="relative w-full h-5 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                            <div
                              className="h-full transition-all duration-500"
                              style={{ width: `${pct}%`, backgroundColor: catColor, opacity: 0.75 }}
                            />
                            <div className="absolute inset-0 flex items-center justify-end pr-2">
                              <span className="text-xs font-bold text-gray-800 dark:text-gray-100">
                                {catTotal > 0 ? `${pct.toFixed(1)}%` : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Form nuova sottocategoria */}
            {!showSubcategoryForm ? (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() => setShowSubcategoryForm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors text-sm font-medium"
                >
                  <span className="text-xl">+</span>
                  <span>Nuova Sottocategoria</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubcategorySubmit} autoComplete="off" className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Nuova Sottocategoria
                </h4>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={subcategoryFormData.name}
                    onChange={(e) => setSubcategoryFormData({ ...subcategoryFormData, name: e.target.value })}
                    className="flex-[3] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
                    placeholder="Nome sottocategoria"
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                    required
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="flex-1 h-10 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center justify-center text-2xl"
                    title="Aggiungi"
                  >
                    ✓
                  </button>
                </div>
              </form>
            )}
          </div>
        </Modal>

        {/* Modal categoria */}
        <Modal
          isOpen={isCategoryModalOpen}
          onClose={() => {
            setIsCategoryModalOpen(false);
          }}
          onBackdropClick={() => {
            setIsCategoryModalOpen(false);
            setIsSubcategoryModalOpen(false);
            setShowSubcategoryForm(false);
            setSubcategoryFormData({ name: '' });
          }}
          title={isEditMode ? 'Modifica Categoria' : 'Nuova Categoria'}
        >
          <form onSubmit={handleCategorySubmit} autoComplete="off" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Nome
              </label>
              <input
                type="text"
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                autoComplete="off" autoCorrect="off" spellCheck={false}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Colore
              </label>
              <div className="flex items-center gap-3">
                <div className="grid grid-cols-8 gap-1.5 flex-1">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryFormData(prev => ({ ...prev, color: c }))}
                      className={`w-7 h-7 rounded-full transition-transform ${categoryFormData.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-gray-500' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setCategoryFormData(prev => ({ ...prev, color: randomPresetColor() }))}
                  className="shrink-0 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-500 dark:hover:text-primary-400 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1"
                >
                  🎲 Random
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Icona
              </label>
              <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
                {(() => {
                  const suggested = getSuggestedIcons(categoryFormData.name);

                  const renderGrid = (icons: string[]) => (
                    <div className="grid grid-cols-7 gap-1.5">
                      {icons.map(icon => (
                        <button
                          key={icon}
                          type="button"
                          onClick={() => setCategoryFormData({ ...categoryFormData, icon })}
                          className={`p-2 text-xl rounded-lg border-2 transition-colors ${
                            categoryFormData.icon === icon
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                              : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  );

                  return (
                    <>
                      {suggested.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-primary-500 dark:text-primary-400 mb-1">✨ Suggeriti</div>
                          {renderGrid(suggested)}
                        </div>
                      )}
                      {ICON_GROUPS.map(group => (
                        <div key={group.tKey}>
                          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">{t(group.tKey)}</div>
                          {renderGrid(group.icons)}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              {isEditMode && selectedCategory ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteCategory(e, selectedCategory.id)}
                    className="flex-1 h-12 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center justify-center text-2xl"
                    title="Elimina"
                  >
                    🗑️
                  </button>
                  <button
                    type="submit"
                    className="flex-1 h-12 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center justify-center text-2xl"
                    title="Salva"
                  >
                    ✓
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  className="w-full h-12 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center justify-center text-2xl"
                  title="Crea"
                >
                  ✓
                </button>
              )}
            </div>
          </form>
        </Modal>

        {/* Date Range Picker */}
        <DateRangePicker
          isOpen={isDatePickerOpen}
          onClose={() => setIsDatePickerOpen(false)}
          onConfirm={handleCustomPeriodConfirm}
          initialStart={startDate}
          initialEnd={endDate}
        />

        {/* Confirm Dialogs */}
        <ConfirmDialog
          isOpen={isDeleteCategoryDialogOpen}
          onClose={() => setIsDeleteCategoryDialogOpen(false)}
          onConfirm={confirmDeleteCategory}
          title="Elimina Categoria"
          message="Sei sicuro di voler eliminare questa categoria? Verranno eliminate anche tutte le sottocategorie associate."
          confirmText="Elimina"
          cancelText="Annulla"
          isDestructive={true}
        />

        <ConfirmDialog
          isOpen={isDeleteSubcategoryDialogOpen}
          onClose={() => setIsDeleteSubcategoryDialogOpen(false)}
          onConfirm={confirmDeleteSubcategory}
          title="Elimina Sottocategoria"
          message="Sei sicuro di voler eliminare questa sottocategoria?"
          confirmText="Elimina"
          cancelText="Annulla"
          isDestructive={true}
        />
      </div>
    </Layout>
  );
}
