import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import { unwrapApiData } from "../lib/apiEnvelope";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";

const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";
const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const EMPTY_ACCOUNT_FORM = {
  label: "",
  facebookPageId: "",
  instagramUserId: "",
  adAccountId: "",
};

export default function AccountSelect() {
  const { accounts, loading, addAccount } = useAccounts();
  const availableAccounts = accounts.length ? accounts : DEFAULT_ACCOUNTS;
  const [get, set] = useQueryState({ account: FALLBACK_ACCOUNT_ID });
  const queryAccount = get("account");
  const [isOpen, setIsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_ACCOUNT_FORM);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountsData, setAccountsData] = useState({});
  const dropdownRef = useRef(null);
  const addFirstInputRef = useRef(null);
  const pendingAccountRef = useRef(null);

  const currentValue = useMemo(() => {
    if (!availableAccounts.length) return "";
    if (queryAccount && availableAccounts.some((account) => account.id === queryAccount)) {
      return queryAccount;
    }
    return availableAccounts[0].id;
  }, [availableAccounts, queryAccount]);

  const currentAccount = useMemo(
    () => availableAccounts.find((acc) => acc.id === currentValue) || availableAccounts[0],
    [availableAccounts, currentValue]
  );

  useEffect(() => {
    if (!availableAccounts.length) return;
    // Se não há conta na query (ou storage), define a primeira disponível
    if (!queryAccount) {
      set({ account: availableAccounts[0].id });
      return;
    }
    // Apenas depois de carregar as contas reais, faça fallback se o ID salvo não existir mais
    if (!loading && !availableAccounts.some((account) => account.id === queryAccount)) {
      set({ account: availableAccounts[0].id });
    }
  }, [availableAccounts, queryAccount, loading, set]);

  useEffect(() => {
    const fetchAccountData = async (account) => {
      if (!account?.instagramUserId || accountsData[account.id]) return;

      try {
        const params = new URLSearchParams({ igUserId: account.instagramUserId, limit: "1" });
        const url = `${API_BASE_URL}/api/instagram/posts?${params.toString()}`;
        const resp = await fetchWithTimeout(url);
        const json = unwrapApiData(await resp.json(), {});

        if (json.account) {
          setAccountsData((prev) => ({
            ...prev,
            [account.id]: {
              username: json.account.username || json.account.name,
              profilePicture: json.account.profile_picture_url,
            },
          }));
        }
      } catch (err) {
        console.warn(`Falha ao carregar dados da conta ${account.id}`, err);
      }
    };

    availableAccounts.forEach((account) => {
      if (account.instagramUserId) {
        fetchAccountData(account);
      }
    });
  }, [availableAccounts, accountsData]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (accountId) => {
    set({ account: accountId });
    setIsOpen(false);
  };

  const isDisabled = availableAccounts.length === 0;

  const getAccountInitials = (label) => {
    if (!label) return "?";
    const parts = label.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  const discoveredAdAccounts = useMemo(() => {
    const map = new Map();
    availableAccounts.forEach((account) => {
      if (!Array.isArray(account?.adAccounts)) return;
      account.adAccounts.forEach((ad) => {
        if (!ad?.id || map.has(ad.id)) return;
        map.set(ad.id, { id: ad.id, name: ad.name || "" });
      });
    });
    return Array.from(map.values());
  }, [availableAccounts]);

  useEffect(() => {
    if (!isAddOpen) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        setIsAddOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    const focusTimeout = setTimeout(() => {
      addFirstInputRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", handler);
      clearTimeout(focusTimeout);
    };
  }, [isAddOpen]);

  useEffect(() => {
    const pending = pendingAccountRef.current;
    if (!pending) return;
    const match = availableAccounts.find(
      (account) =>
        account.facebookPageId === pending.facebookPageId
        || account.instagramUserId === pending.instagramUserId
        || account.label === pending.label,
    );
    if (match) {
      set({ account: match.id });
      pendingAccountRef.current = null;
    }
  }, [availableAccounts, set]);

  return (
    <div className="account-dropdown" ref={dropdownRef}>
      <label className="account-dropdown__label" htmlFor="account-select">Conta</label>
      {isDisabled ? (
        <div className="filter-select__empty" role="note">
          <span>Cadastre uma conta nas configuracoes.</span>
          <button
            type="button"
            className="account-dropdown__add-button"
            onClick={() => {
              setIsOpen(false);
              setFormError("");
              setFormData(EMPTY_ACCOUNT_FORM);
              setIsAddOpen(true);
            }}
          >
            <Plus size={14} /> Adicionar conta
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="account-dropdown__trigger"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
          >
            <div className="account-dropdown__current">
              {accountsData[currentAccount?.id]?.profilePicture ? (
                <img
                  src={accountsData[currentAccount.id].profilePicture}
                  alt={currentAccount.label}
                  className="account-dropdown__avatar"
                />
              ) : (
                <span className="account-dropdown__avatar-placeholder">
                  {getAccountInitials(currentAccount?.label)}
                </span>
              )}
              <span className="account-dropdown__name">
                {accountsData[currentAccount?.id]?.username || currentAccount?.label}
              </span>
            </div>
            <ChevronDown size={16} className={`account-dropdown__icon${isOpen ? " account-dropdown__icon--open" : ""}`} />
          </button>

          {isOpen && (
            <ul className="account-dropdown__list" role="listbox">
              {availableAccounts.map((account) => (
                <li key={account.id} role="option" aria-selected={account.id === currentValue}>
                  <button
                    type="button"
                    className={`account-dropdown__item${account.id === currentValue ? " account-dropdown__item--active" : ""}`}
                    onClick={() => handleSelect(account.id)}
                  >
                    {accountsData[account.id]?.profilePicture ? (
                      <img
                        src={accountsData[account.id].profilePicture}
                        alt={account.label}
                        className="account-dropdown__avatar"
                      />
                    ) : (
                      <span className="account-dropdown__avatar-placeholder">
                        {getAccountInitials(account.label)}
                      </span>
                    )}
                    <span className="account-dropdown__item-name">
                      {accountsData[account.id]?.username || account.label}
                    </span>
                  </button>
                </li>
              ))}
              <li className="account-dropdown__divider" role="presentation" />
              <li role="presentation">
                <button
                  type="button"
                  className="account-dropdown__add-button"
                  onClick={() => {
                    setIsOpen(false);
                    setFormError("");
                    setFormData(EMPTY_ACCOUNT_FORM);
                    setIsAddOpen(true);
                  }}
                >
                  <Plus size={14} /> Adicionar conta
                </button>
              </li>
            </ul>
          )}
        </>
      )}
      {isAddOpen ? (
        <div className="account-add-modal" role="dialog" aria-modal="true" aria-labelledby="account-add-title">
          <div
            className="account-add-modal__overlay"
            onClick={() => {
              if (!isSubmitting) {
                setIsAddOpen(false);
                setFormError("");
              }
            }}
          />
          <div
            className="account-add-modal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="account-add-modal__header">
              <div>
                <h2 className="account-add-modal__title" id="account-add-title">Adicionar conta</h2>
                <p className="account-add-modal__subtitle">Use os mesmos dados da area de contas conectadas.</p>
              </div>
              <button
                type="button"
                className="account-add-modal__close"
                onClick={() => {
                  if (!isSubmitting) {
                    setIsAddOpen(false);
                    setFormError("");
                  }
                }}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <form
              className="accounts-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (isSubmitting) return;
                const trimmed = {
                  label: formData.label.trim(),
                  facebookPageId: formData.facebookPageId.trim(),
                  instagramUserId: formData.instagramUserId.trim(),
                  adAccountId: formData.adAccountId.trim(),
                };
                if (!trimmed.label || !trimmed.facebookPageId || !trimmed.instagramUserId || !trimmed.adAccountId) {
                  setFormError("Preencha todos os campos.");
                  return;
                }
                setFormError("");
                setIsSubmitting(true);
                pendingAccountRef.current = trimmed;
                const clearPendingTimeout = setTimeout(() => {
                  if (pendingAccountRef.current === trimmed) {
                    pendingAccountRef.current = null;
                  }
                }, 8000);
                try {
                  await addAccount(trimmed);
                  setFormData(EMPTY_ACCOUNT_FORM);
                  setIsAddOpen(false);
                } catch (err) {
                  pendingAccountRef.current = null;
                  setFormError(err?.message || "Nao foi possivel adicionar a conta.");
                } finally {
                  clearTimeout(clearPendingTimeout);
                  setIsSubmitting(false);
                }
              }}
            >
              <div className="accounts-form__field">
                <label htmlFor="account-name-dropdown">Nome</label>
                <input
                  id="account-name-dropdown"
                  name="label"
                  ref={addFirstInputRef}
                  value={formData.label}
                  onChange={(event) => {
                    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                  }}
                  placeholder="Ex: Cliente - Marca"
                />
              </div>

              <div className="accounts-form__field">
                <label htmlFor="account-page-id-dropdown">ID da pagina</label>
                <input
                  id="account-page-id-dropdown"
                  name="facebookPageId"
                  value={formData.facebookPageId}
                  onChange={(event) => {
                    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                  }}
                  placeholder="1234567890"
                />
              </div>

              <div className="accounts-form__field">
                <label htmlFor="account-ig-id-dropdown">ID Instagram</label>
                <input
                  id="account-ig-id-dropdown"
                  name="instagramUserId"
                  value={formData.instagramUserId}
                  onChange={(event) => {
                    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                  }}
                  placeholder="1784..."
                />
              </div>

              <div className="accounts-form__field">
                <label htmlFor="account-ads-id-dropdown">ID conta de anuncios</label>
                <input
                  id="account-ads-id-dropdown"
                  name="adAccountId"
                  value={formData.adAccountId}
                  onChange={(event) => {
                    setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                  }}
                  placeholder="act_..."
                  list="ad-accounts-options-dropdown"
                />
                {discoveredAdAccounts.length > 0 ? (
                  <>
                    <datalist id="ad-accounts-options-dropdown">
                      {discoveredAdAccounts.map((ad) => (
                        <option key={ad.id} value={ad.id}>
                          {ad.name || ad.id}
                        </option>
                      ))}
                    </datalist>
                    <p className="settings-hint">
                      Selecione uma conta de anuncios descoberta ou digite um ID manualmente.
                    </p>
                  </>
                ) : null}
              </div>

              {formError && <p className="settings-form-error" role="alert">{formError}</p>}

              <div className="account-add-modal__footer">
                <button
                  type="button"
                  className="settings-button settings-button--outline"
                  onClick={() => {
                    if (!isSubmitting) {
                      setIsAddOpen(false);
                      setFormError("");
                    }
                  }}
                  disabled={isSubmitting}
                >
                  Cancelar
                </button>
                <button type="submit" className="settings-button" disabled={isSubmitting}>
                  {isSubmitting ? "Salvando..." : "Adicionar conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
