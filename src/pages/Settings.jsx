import { useEffect, useMemo, useState } from 'react';

import { useOutletContext } from 'react-router-dom';

import { ChevronDown, Edit3, Plus, Trash2, Settings as SettingsIcon, Check, X } from 'lucide-react';

import { useAccounts } from '../context/AccountsContext';

import NavigationHero from '../components/NavigationHero';
import { buildLegalUrl } from '../lib/legalLinks';



const NOTIFICATION_STORAGE_KEY = 'ui-notifications-enabled';

const SECTION_STATE = { alerts: true, accounts: true };

const ACCOUNT_FORM_INITIAL = {

  label: '',

  facebookPageId: '',

  instagramUserId: '',

  adAccountId: '',

};



export default function Settings() {
  const outletContext = useOutletContext() || {};
  const { setTopbarConfig, resetTopbarConfig } = outletContext;

  useEffect(() => {
    if (!setTopbarConfig) return undefined;
    setTopbarConfig({ title: "Configuracoes", showFilters: false });
    return () => resetTopbarConfig?.();
  }, [setTopbarConfig, resetTopbarConfig]);

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
                  <div style={{ marginBottom: '1rem', padding: '12px', border: '1px solid #e5e7eb', borderRadius: '12px', background: '#f9fafb' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 160px', minWidth: 160 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Páginas</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{discoveredPages.length}</div>
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 160 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Contas Instagram</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{discoveredIgAccounts.length}</div>
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 160 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Contas de anúncios</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{discoveredAdAccounts.length}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                      {discoveredPages.map((page) => {
                        const isEditing = editingCardId === page.id;
                        const account = accounts.find((acc) => acc.facebookPageId === page.id);

                        return (
                          <div key={page.id} style={{ background: '#fff', border: isEditing ? '2px solid #223A3A' : '1px solid #e5e7eb', borderRadius: '12px', padding: '10px 12px' }}>
                            {isEditing ? (
                              // Modo de edição inline
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Nome</label>
                                  <input
                                    type="text"
                                    name="label"
                                    value={editingCardData.label}
                                    onChange={handleCardFieldChange}
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      fontSize: '0.875rem',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Page ID</label>
                                  <input
                                    type="text"
                                    name="facebookPageId"
                                    value={editingCardData.facebookPageId}
                                    onChange={handleCardFieldChange}
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      fontSize: '0.875rem',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Instagram ID</label>
                                  <input
                                    type="text"
                                    name="instagramUserId"
                                    value={editingCardData.instagramUserId}
                                    onChange={handleCardFieldChange}
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      fontSize: '0.875rem',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Ad Account ID</label>
                                  <input
                                    type="text"
                                    name="adAccountId"
                                    value={editingCardData.adAccountId}
                                    onChange={handleCardFieldChange}
                                    list="ad-accounts-options-inline"
                                    style={{
                                      width: '100%',
                                      padding: '6px 8px',
                                      fontSize: '0.875rem',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      outline: 'none',
                                    }}
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
                                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveCardEdit(page.id)}
                                    style={{
                                      flex: 1,
                                      padding: '6px 10px',
                                      fontSize: '0.85rem',
                                      fontWeight: 600,
                                      background: '#223A3A',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <Check size={14} />
                                    Salvar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelCardEdit}
                                    style={{
                                      flex: 1,
                                      padding: '6px 10px',
                                      fontSize: '0.85rem',
                                      fontWeight: 600,
                                      background: '#fff',
                                      color: '#6b7280',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <X size={14} />
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // Modo de visualização
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>{page.label}</div>
                                    <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Page ID: {page.id}</div>
                                    {page.instagramUserId ? (
                                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>IG ID: {page.instagramUserId}</div>
                                    ) : (
                                      <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>IG não vinculado</div>
                                    )}
                                    {page.adAccountId ? (
                                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Ad Account: {page.adAccountId}</div>
                                    ) : (
                                      <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Conta de anúncios não vinculada</div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleEditCard(page.id)}
                                      style={{
                                        padding: '6px',
                                        background: 'transparent',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: '#223A3A',
                                      }}
                                      title="Editar"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCard(page.id)}
                                      style={{
                                        padding: '6px',
                                        background: 'transparent',
                                        border: '1px solid #fecdd3',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: '#b91c1c',
                                      }}
                                      title="Remover"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                                {Array.isArray(page.adAccounts) && page.adAccounts.length > 0 ? (
                                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <label style={{ fontSize: '0.8rem', color: '#6b7280' }}>Conta de anuncios</label>
                                    {page.adAccounts.length > 1 ? (
                                      <select
                                        value={page.adAccountId || (page.adAccounts[0]?.id || '')}
                                        onChange={(event) => handleAdAccountSelect(page.id, event.target.value)}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          border: '1px solid #d1d5db',
                                          borderRadius: '8px',
                                          background: '#fff',
                                          fontSize: '0.9rem',
                                          color: '#111827',
                                        }}
                                        disabled={adAccountSaving === page.id}
                                      >
                                        {page.adAccounts.map((ad) => (
                                          <option key={ad.id} value={ad.id}>
                                            {ad.name || ad.id} - {ad.id}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div style={{ fontSize: '0.85rem', color: '#4b5563', padding: '6px 8px', background: '#f3f4f6', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                                        Usando conta de anuncios: {page.adAccountId || page.adAccounts[0].id}
                                      </div>
                                    )}
                                    {page.usesAdFallback && (
                                      <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                                        Selecionamos a primeira conta de anuncios detectada para esta pagina.
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#9ca3af' }}>
                                    {page.adAccountId ? `Usando conta de anuncios: ${page.adAccountId}` : 'Sem contas de anuncios vinculadas'}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '24px', padding: '16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '12px', color: '#111827' }}>
                    <Plus size={18} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                    Adicionar nova conta
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '16px' }}>
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

        <footer style={{ marginTop: '2rem', textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <a
              href={buildLegalUrl('/legal/terms-of-service.html')}
              style={{ color: '#7c3aed', textDecoration: 'underline', fontWeight: 500 }}
              target="_blank"
              rel="noreferrer"
            >
              Termos de Serviço
            </a>
            <a
              href={buildLegalUrl('/legal/privacy-policy.html')}
              style={{ color: '#7c3aed', textDecoration: 'underline', fontWeight: 500 }}
              target="_blank"
              rel="noreferrer"
            >
              Políticas de Privacidade
            </a>
            <a
              href={buildLegalUrl('/legal/privacy-policy-en.html')}
              style={{ color: '#7c3aed', textDecoration: 'underline', fontWeight: 500 }}
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </a>
          </div>
        </footer>

      </div>

    </div>

  );

}


