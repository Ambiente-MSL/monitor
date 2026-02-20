import { useEffect, useMemo, useState } from 'react';

import { useOutletContext } from 'react-router-dom';

import { ChevronDown, Edit3, Plus, Trash2, Settings as SettingsIcon, Check, X, Sun, Moon, Monitor } from 'lucide-react';

import { useAccounts } from '../context/AccountsContext';
import { useTheme } from '../context/ThemeContext';

import NavigationHero from '../components/NavigationHero';
import { buildLegalUrl } from '../lib/legalLinks';



const NOTIFICATION_STORAGE_KEY = 'ui-notifications-enabled';

const SECTION_STATE = { appearance: true, alerts: false, accounts: true };

const ACCOUNT_FORM_INITIAL = {

  label: '',

  facebookPageId: '',

  instagramUserId: '',

  adAccountId: '',

};

const THEME_OPTIONS = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'auto', label: 'Automático', Icon: Monitor },
  { value: 'dark', label: 'Escuro', Icon: Moon },
];


export default function Settings() {
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({ title: "Configuracoes", showFilters: false });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig]);

  const { theme, setTheme } = useTheme();

  const { accounts, addAccount, updateAccount, removeAccount } = useAccounts();
  const discoveredAdAccounts = useMemo(() => {
    const map = new Map();
    accounts.forEach((account) => {
      if (Array.isArray(account?.adAccounts)) {
        account.adAccounts.forEach((ad) => {
          if (!ad || !ad.id) return;
          const id = String(ad.id);
          if (!map.has(id)) {
            map.set(id, {
              id,
              name: ad.name || id,
              currency: ad.currency || "",
            });
          }
        });
      }
    });
    return Array.from(map.values());
  }, [accounts]);
  const discoveredPages = useMemo(
    () => accounts.filter((acc) => acc.facebookPageId).map((acc) => {
      const adAccounts = Array.isArray(acc.adAccounts) ? acc.adAccounts : [];
      const resolvedAdAccountId = acc.adAccountId || (adAccounts[0]?.id || "");
      const usesAdFallback = !acc.adAccountId && adAccounts.length > 0;
      return {
        id: acc.facebookPageId,
        label: acc.label || acc.facebookPageId,
        instagramUserId: acc.instagramUserId || "",
        adAccountId: resolvedAdAccountId,
        adAccounts,
        usesAdFallback,
      };
    }),
    [accounts],
  );
  const discoveredIgAccounts = useMemo(
    () => accounts.filter((acc) => acc.instagramUserId).map((acc) => ({
      id: acc.instagramUserId,
      label: acc.instagramUsername || acc.label || acc.instagramUserId,
      pageId: acc.facebookPageId || "",
    })),
    [accounts],
  );



  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {

    if (typeof window === 'undefined') return true;

    const stored = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);

    if (stored === null) return true;

    return stored === 'true';

  });



  const [openSections, setOpenSections] = useState(SECTION_STATE);

  const [formData, setFormData] = useState(ACCOUNT_FORM_INITIAL);

  const [formError, setFormError] = useState('');

  const [editingCardId, setEditingCardId] = useState(null);

  const [editingCardData, setEditingCardData] = useState(ACCOUNT_FORM_INITIAL);
  const [adAccountSaving, setAdAccountSaving] = useState('');



  useEffect(() => {

    if (typeof window === 'undefined') return;

    window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, String(notificationsEnabled));

  }, [notificationsEnabled]);

  const alertExamples = useMemo(

    () => [

      {

        id: 'reach-drop',

        type: 'warning',

        title: 'Alcance em queda',

        message: 'O alcance caiu 35% em relacao a semana anterior.'

      },

      {

        id: 'post-engagement',

        type: 'positive',

        title: 'Post em alta',

        message: 'Novo post com +10% de engajamento que a media.'

      },

      {

        id: 'budget-cap',

        type: 'critical',

        title: 'Campanha limitada',

        message: 'Campanha X atingiu o limite de orcamento.'

      }

    ],

    []

  );



  const activeAlerts = notificationsEnabled ? alertExamples : [];


  const toggleSection = (key) => {

    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  };



  const handleFieldChange = (event) => {

    const { name, value } = event.target;

    setFormData((prev) => ({ ...prev, [name]: value }));

  };



  const resetForm = () => {

    setFormData(ACCOUNT_FORM_INITIAL);

    setFormError('');

  };



  const handleSubmit = async (event) => {

    event.preventDefault();

    const trimmed = {

      label: formData.label.trim(),

      facebookPageId: formData.facebookPageId.trim(),

      instagramUserId: formData.instagramUserId.trim(),

      adAccountId: formData.adAccountId.trim(),

    };



    if (!trimmed.label || !trimmed.facebookPageId || !trimmed.instagramUserId || !trimmed.adAccountId) {

      setFormError('Preencha todos os campos obrigatorios.');

      return;

    }



    try {
      await addAccount(trimmed);
      resetForm();
      setOpenSections((prev) => ({ ...prev, accounts: true }));
    } catch (err) {
      setFormError('Não foi possível salvar a conta. Tente novamente.');
    }

  };



  const handleDelete = async (accountId) => {

    if (accounts.length <= 1) {

      setFormError('Mantenha ao menos uma conta cadastrada.');

      return;

    }



    const confirmed = typeof window === 'undefined' ? true : window.confirm('Remover esta conta? Esta acao pode afetar os filtros dos dashboards.');

    if (!confirmed) return;

    await removeAccount(accountId);

  };

  const handleAdAccountSelect = async (pageId, adAccountId) => {
    const account = accounts.find((acc) => acc.facebookPageId === pageId);
    if (!account || !adAccountId) return;

    setAdAccountSaving(pageId);
    try {
      await updateAccount(account.id, {
        label: account.label || '',
        facebookPageId: account.facebookPageId || '',
        instagramUserId: account.instagramUserId || '',
        adAccountId,
        profilePictureUrl: account.profilePictureUrl || '',
        pagePictureUrl: account.pagePictureUrl || '',
      });
      setFormError('');
    } catch (err) {
      setFormError('Nao foi possivel salvar a conta de anuncios selecionada.');
    } finally {
      setAdAccountSaving('');
    }
  };

  const handleEditCard = (pageId) => {
    const account = accounts.find((acc) => acc.facebookPageId === pageId);
    if (!account) return;

    setEditingCardId(pageId);
    setEditingCardData({
      label: account.label || '',
      facebookPageId: account.facebookPageId || '',
      instagramUserId: account.instagramUserId || '',
      adAccountId: account.adAccountId || (Array.isArray(account.adAccounts) && account.adAccounts[0]?.id) || '',
    });
  };

  const handleCancelCardEdit = () => {
    setEditingCardId(null);
    setEditingCardData(ACCOUNT_FORM_INITIAL);
  };

  const handleCardFieldChange = (event) => {
    const { name, value } = event.target;
    setEditingCardData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveCardEdit = async (pageId) => {
    const account = accounts.find((acc) => acc.facebookPageId === pageId);
    if (!account) return;

    const trimmed = {
      label: editingCardData.label.trim(),
      facebookPageId: editingCardData.facebookPageId.trim(),
      instagramUserId: editingCardData.instagramUserId.trim(),
      adAccountId: editingCardData.adAccountId.trim(),
    };

    if (!trimmed.label || !trimmed.facebookPageId || !trimmed.instagramUserId || !trimmed.adAccountId) {
      setFormError('Preencha todos os campos obrigatorios.');
      return;
    }

    try {
      await updateAccount(account.id, trimmed);
      setEditingCardId(null);
      setEditingCardData(ACCOUNT_FORM_INITIAL);
      setFormError('');
    } catch (err) {
      setFormError('Não foi possível salvar as alterações.');
    }
  };

  const handleDeleteCard = async (pageId) => {
    const account = accounts.find((acc) => acc.facebookPageId === pageId);
    if (!account) return;
    await handleDelete(account.id);
  };



  return (
    <div className="instagram-dashboard--clean">
      <div className="ig-clean-container">
        <NavigationHero title="Configurações" icon={SettingsIcon} showGradient={false} />

        <div className="page-content">

        <div className="settings-layout">

          {/* ===== Seção: Aparência ===== */}
          <section className={`settings-section ${openSections.appearance ? 'is-open' : ''}`}>
            <button
              type="button"
              className="settings-section__header"
              onClick={() => toggleSection('appearance')}
              aria-expanded={openSections.appearance}
            >
              <div className="settings-section__header-text">
                <h2 className="settings-section__title">Aparência</h2>
                <p className="settings-section__subtitle">Escolha como o painel deve ser exibido.</p>
              </div>
              <ChevronDown className={`settings-section__icon ${openSections.appearance ? 'is-open' : ''}`} size={18} />
            </button>

            {openSections.appearance && (
              <div className="settings-section__body">
                <div className="theme-picker" role="radiogroup" aria-label="Tema do painel">
                  {THEME_OPTIONS.map(({ value, label, Icon }) => {
                    const isActive = theme === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`theme-picker__option${isActive ? ' theme-picker__option--active' : ''}`}
                        onClick={() => setTheme(value)}
                      >
                        <div className="theme-picker__icon">
                          <Icon size={20} />
                        </div>
                        <span className="theme-picker__label">{label}</span>
                        <span className="theme-picker__check" aria-hidden="true">
                          <Check size={10} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ===== Seção: Alertas ===== */}
          <section className={`settings-section ${openSections.alerts ? 'is-open' : ''}`}>

            <button

              type="button"

              className="settings-section__header"

              onClick={() => toggleSection('alerts')}

              aria-expanded={openSections.alerts}

            >

              <div className="settings-section__header-text">

                <h2 className="settings-section__title">Alertas de desempenho</h2>

                <p className="settings-section__subtitle">Receba avisos automaticos quando indicadores mudarem de forma relevante.</p>

              </div>

              <ChevronDown className={`settings-section__icon ${openSections.alerts ? 'is-open' : ''}`} size={18} />

            </button>

            {openSections.alerts && (

              <div className="settings-section__body">

                <button

                  type="button"

                  className={`settings-toggle ${notificationsEnabled ? 'settings-toggle--on' : ''}`}

                  onClick={() => setNotificationsEnabled((prev) => !prev)}

                  aria-pressed={notificationsEnabled}

                >

                  {notificationsEnabled ? 'Alertas ativados' : 'Alertas desativados'}

                </button>



                {notificationsEnabled ? (

                  <div className="settings-alerts" aria-live="polite">

                    {activeAlerts.map((alert) => (

                      <div key={alert.id} className={`settings-alert settings-alert--${alert.type}`}>

                        <div>

                          <div className="settings-alert__title">{alert.title}</div>

                          <div className="settings-alert__message">{alert.message}</div>

                        </div>

                        <span className="settings-alert__badge">monitoramento</span>

                      </div>

                    ))}

                  </div>

                ) : (

                  <p className="settings-hint">Os alertas estao desativados.</p>

                )}



                <p className="settings-hint">

                  Os alertas consideram variacoes de alcance, engajamento e limites de campanhas. Ajuste as regras no painel de relatorios para refinar quando cada aviso deve ser enviado.

                </p>

              </div>

            )}

          </section>

          {/* ===== Seção: Contas conectadas ===== */}
          <section className={`settings-section ${openSections.accounts ? 'is-open' : ''}`}>

            <button

              type="button"

              className="settings-section__header"

              onClick={() => toggleSection('accounts')}

              aria-expanded={openSections.accounts}

            >

              <div className="settings-section__header-text">

                <h2 className="settings-section__title">Contas conectadas</h2>

                <p className="settings-section__subtitle">Adicione, edite ou remova paginas que aparecem nos filtros.</p>

              </div>

              <ChevronDown className={`settings-section__icon ${openSections.accounts ? 'is-open' : ''}`} size={18} />

            </button>

            {openSections.accounts && (

              <div className="settings-section__body">

                {/* Painel de contas descobertas */}
                {accounts.length > 0 && (
                  <div className="settings-accounts-summary">
                    <div className="settings-accounts-summary__stats">
                      <div className="settings-accounts-summary__stat">
                        <div className="settings-accounts-summary__stat-label">Páginas</div>
                        <div className="settings-accounts-summary__stat-value">{discoveredPages.length}</div>
                      </div>
                      <div className="settings-accounts-summary__stat">
                        <div className="settings-accounts-summary__stat-label">Contas Instagram</div>
                        <div className="settings-accounts-summary__stat-value">{discoveredIgAccounts.length}</div>
                      </div>
                      <div className="settings-accounts-summary__stat">
                        <div className="settings-accounts-summary__stat-label">Contas de anúncios</div>
                        <div className="settings-accounts-summary__stat-value">{discoveredAdAccounts.length}</div>
                      </div>
                    </div>

                    <div className="settings-accounts-grid">
                      {discoveredPages.map((page) => {
                        const isEditing = editingCardId === page.id;

                        return (
                          <div
                            key={page.id}
                            className={`settings-account-card${isEditing ? ' settings-account-card--editing' : ''}`}
                          >
                            {isEditing ? (
                              <div className="settings-account-card__edit">
                                <div>
                                  <label className="settings-account-label">Nome</label>
                                  <input
                                    type="text"
                                    name="label"
                                    value={editingCardData.label}
                                    onChange={handleCardFieldChange}
                                    className="settings-account-input"
                                  />
                                </div>
                                <div>
                                  <label className="settings-account-label">Page ID</label>
                                  <input
                                    type="text"
                                    name="facebookPageId"
                                    value={editingCardData.facebookPageId}
                                    onChange={handleCardFieldChange}
                                    className="settings-account-input"
                                  />
                                </div>
                                <div>
                                  <label className="settings-account-label">Instagram ID</label>
                                  <input
                                    type="text"
                                    name="instagramUserId"
                                    value={editingCardData.instagramUserId}
                                    onChange={handleCardFieldChange}
                                    className="settings-account-input"
                                  />
                                </div>
                                <div>
                                  <label className="settings-account-label">Ad Account ID</label>
                                  <input
                                    type="text"
                                    name="adAccountId"
                                    value={editingCardData.adAccountId}
                                    onChange={handleCardFieldChange}
                                    list="ad-accounts-options-inline"
                                    className="settings-account-input"
                                  />
                                  {discoveredAdAccounts.length > 0 && (
                                    <datalist id="ad-accounts-options-inline">
                                      {discoveredAdAccounts.map((ad) => (
                                        <option key={ad.id} value={ad.id}>
                                          {ad.name || ad.id}
                                        </option>
                                      ))}
                                    </datalist>
                                  )}
                                </div>
                                <div className="settings-account-edit-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveCardEdit(page.id)}
                                    className="settings-account-btn-save"
                                  >
                                    <Check size={14} />
                                    Salvar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelCardEdit}
                                    className="settings-account-btn-cancel"
                                  >
                                    <X size={14} />
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="settings-account-card__view">
                                <div className="settings-account-card__header">
                                  <div className="settings-account-card__info">
                                    <div className="settings-account-card__name">{page.label}</div>
                                    <div className="settings-account-card__meta">Page ID: {page.id}</div>
                                    {page.instagramUserId ? (
                                      <div className="settings-account-card__meta">IG ID: {page.instagramUserId}</div>
                                    ) : (
                                      <div className="settings-account-card__meta--empty">IG não vinculado</div>
                                    )}
                                    {page.adAccountId ? (
                                      <div className="settings-account-card__meta">Ad Account: {page.adAccountId}</div>
                                    ) : (
                                      <div className="settings-account-card__meta--empty">Conta de anúncios não vinculada</div>
                                    )}
                                  </div>
                                  <div className="settings-account-card__actions">
                                    <button
                                      type="button"
                                      onClick={() => handleEditCard(page.id)}
                                      className="settings-account-card__btn"
                                      title="Editar"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCard(page.id)}
                                      className="settings-account-card__btn settings-account-card__btn--danger"
                                      title="Remover"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                                {Array.isArray(page.adAccounts) && page.adAccounts.length > 0 ? (
                                  <div className="settings-account-card__ad-section">
                                    <label className="settings-account-card__ad-label">Conta de anuncios</label>
                                    {page.adAccounts.length > 1 ? (
                                      <select
                                        value={page.adAccountId || (page.adAccounts[0]?.id || '')}
                                        onChange={(event) => handleAdAccountSelect(page.id, event.target.value)}
                                        className="settings-account-select"
                                        disabled={adAccountSaving === page.id}
                                      >
                                        {page.adAccounts.map((ad) => (
                                          <option key={ad.id} value={ad.id}>
                                            {ad.name || ad.id} - {ad.id}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div className="settings-account-card__ad-info">
                                        Usando conta de anuncios: {page.adAccountId || page.adAccounts[0].id}
                                      </div>
                                    )}
                                    {page.usesAdFallback && (
                                      <div className="settings-account-card__ad-note">
                                        Selecionamos a primeira conta de anuncios detectada para esta pagina.
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="settings-account-card__ad-empty">
                                    {page.adAccountId ? `Usando conta de anuncios: ${page.adAccountId}` : 'Sem contas de anuncios vinculadas'}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="settings-add-account-panel">
                  <h3 className="settings-add-account-panel__title">
                    <Plus size={18} />
                    Adicionar nova conta
                  </h3>
                  <p className="settings-add-account-panel__desc">
                    Preencha os campos abaixo para adicionar uma nova conta ao sistema.
                  </p>

                  <form className="accounts-form" onSubmit={handleSubmit}>

                    <div className="accounts-form__field">

                      <label htmlFor="account-name">Nome</label>

                      <input

                        id="account-name"

                        name="label"

                        value={formData.label}

                        onChange={handleFieldChange}

                        placeholder="Ex: Cliente - Marca"

                      />

                    </div>

                    <div className="accounts-form__field">

                      <label htmlFor="account-page-id">ID da pagina</label>

                      <input

                        id="account-page-id"

                        name="facebookPageId"

                        value={formData.facebookPageId}

                        onChange={handleFieldChange}

                        placeholder="1234567890"

                      />

                    </div>

                    <div className="accounts-form__field">

                      <label htmlFor="account-ig-id">ID Instagram</label>

                      <input

                        id="account-ig-id"

                        name="instagramUserId"

                        value={formData.instagramUserId}

                        onChange={handleFieldChange}

                        placeholder="1784..."

                      />

                    </div>

                    <div className="accounts-form__field">
                      <label htmlFor="account-ads-id">ID conta de anuncios</label>
                      <input
                        id="account-ads-id"
                        name="adAccountId"
                        value={formData.adAccountId}
                        onChange={handleFieldChange}
                        placeholder="act_..."
                        list="ad-accounts-options"
                      />
                      {discoveredAdAccounts.length > 0 && (
                        <>
                          <datalist id="ad-accounts-options">
                            {discoveredAdAccounts.map((ad) => (
                              <option key={ad.id} value={ad.id}>
                                {ad.name || ad.id}
                              </option>
                            ))}
                          </datalist>
                          <p className="settings-hint">
                            Selecione uma das contas de anúncios descobertas ou digite um ID manualmente.
                          </p>
                        </>
                      )}
                    </div>



                    {formError && <p className="settings-form-error" role="alert">{formError}</p>}



                    <div className="accounts-form__actions">

                      <button type="submit" className="settings-button">

                        <Plus size={16} /> Adicionar conta

                      </button>

                    </div>

                  </form>
                </div>

              </div>

            )}

          </section>

        </div>

        </div>

        <footer className="settings-footer">
          <a
            href={buildLegalUrl('/legal/terms-of-service.html')}
            className="settings-footer__link"
            target="_blank"
            rel="noreferrer"
          >
            Termos de Serviço
          </a>
          <a
            href={buildLegalUrl('/legal/privacy-policy.html')}
            className="settings-footer__link"
            target="_blank"
            rel="noreferrer"
          >
            Políticas de Privacidade
          </a>
          <a
            href={buildLegalUrl('/legal/privacy-policy-en.html')}
            className="settings-footer__link"
            target="_blank"
            rel="noreferrer"
          >
            Privacy Policy
          </a>
        </footer>

      </div>

    </div>

  );

}
