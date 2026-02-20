import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { ChevronDown, LogOut, Plus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { useAuth } from "../context/AuthContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import { unwrapApiData } from "../lib/apiEnvelope";
import AvatarWithFallback from "./AvatarWithFallback";
import { buildInstagramAvatarCandidates } from "../lib/avatar";

const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";
const EMPTY_ACCOUNT_FORM = {
  label: "",
  facebookPageId: "",
  instagramUserId: "",
  adAccountId: "",
};

export default function AccountSelect() {
  const { accounts, loading, addAccount } = useAccounts();
  const { token, signOut, apiFetch } = useAuth();
  const navigate = useNavigate();
  const availableAccounts = accounts.length ? accounts : DEFAULT_ACCOUNTS;
  const [get, set] = useQueryState({ account: FALLBACK_ACCOUNT_ID });
  const queryAccount = get("account");
  const [isOpen, setIsOpen] = useState(false);
  const [isAddFormVisible, setIsAddFormVisible] = useState(false);
  const [formData, setFormData] = useState(EMPTY_ACCOUNT_FORM);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [accountsData, setAccountsData] = useState({});
  const dropdownRef = useRef(null);
  const addFirstInputRef = useRef(null);
  const pendingAccountRef = useRef(null);
  const accountProfileRequestsRef = useRef(new Set());

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
  const resolveAccountDisplay = useCallback((account) => {
    const cached = account?.id ? accountsData[account.id] : null;
    return {
      username: cached?.username || account?.instagramUsername || account?.label || "",
      profilePictureCandidates: buildInstagramAvatarCandidates({
        instagramUserId: account?.instagramUserId,
        profilePictureUrl: cached?.profilePicture || account?.profilePictureUrl || null,
        pagePictureUrl: account?.pagePictureUrl || null,
      }),
    };
  }, [accountsData]);

  const currentAccountDisplay = useMemo(
    () => resolveAccountDisplay(currentAccount),
    [currentAccount, resolveAccountDisplay],
  );
  const currentAccountLabel = currentAccountDisplay.username;

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
    setAccountsData((prev) => {
      let changed = false;
      const next = { ...prev };
      availableAccounts.forEach((account) => {
        const accountId = account?.id;
        if (!accountId || next[accountId]) return;
        const username = String(account?.instagramUsername || "").trim();
        const profilePicture = String(account?.profilePictureUrl || account?.pagePictureUrl || "").trim();
        if (!username && !profilePicture) return;
        next[accountId] = {
          username: username || account.label || "",
          profilePicture: profilePicture || null,
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [availableAccounts]);

  const accountsToEnrich = useMemo(() => {
    const scopedAccounts = isOpen ? availableAccounts : currentAccount ? [currentAccount] : [];
    return scopedAccounts.filter((account) => {
      if (!account?.id || !account?.instagramUserId) return false;
      const cached = accountsData[account.id];
      const hasUsername = Boolean(
        String(cached?.username || account?.instagramUsername || "").trim(),
      );
      const hasProfilePicture = Boolean(
        String(cached?.profilePicture || account?.profilePictureUrl || account?.pagePictureUrl || "").trim(),
      );
      return !(hasUsername && hasProfilePicture);
    });
  }, [availableAccounts, currentAccount, isOpen, accountsData]);

  useEffect(() => {
    if (!token || !accountsToEnrich.length) return undefined;
    let cancelled = false;

    const fetchAccountData = async (account) => {
      const accountId = account?.id;
      if (!accountId || accountProfileRequestsRef.current.has(accountId)) return;
      accountProfileRequestsRef.current.add(accountId);
      try {
        const params = new URLSearchParams({ igUserId: account.instagramUserId, limit: "1" });
        const payload = await apiFetch(`/api/instagram/posts?${params.toString()}`, { timeoutMs: 12000 });
        const json = unwrapApiData(payload, {});
        const accountPayload = json?.account;
        if (!accountPayload || cancelled) return;
        setAccountsData((prev) => {
          const previous = prev[accountId] || {};
          const nextUsername = accountPayload.username
            || accountPayload.name
            || previous.username
            || account.instagramUsername
            || account.label
            || "";
          const nextProfilePicture = accountPayload.profile_picture_url
            || previous.profilePicture
            || account.profilePictureUrl
            || account.pagePictureUrl
            || null;
          if (
            previous.username === nextUsername
            && previous.profilePicture === nextProfilePicture
          ) {
            return prev;
          }
          return {
            ...prev,
            [accountId]: {
              username: nextUsername,
              profilePicture: nextProfilePicture,
            },
          };
        });
      } catch (err) {
        if (!cancelled) {
          console.warn(`Falha ao carregar dados da conta ${account.id}`, err);
        }
      } finally {
        accountProfileRequestsRef.current.delete(accountId);
      }
    };

    accountsToEnrich.forEach((account) => {
      fetchAccountData(account);
    });

    return () => {
      cancelled = true;
    };
  }, [accountsToEnrich, apiFetch, token]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setIsAddFormVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (accountId) => {
    set({ account: accountId });
    setIsOpen(false);
  };

  const handleLogout = useCallback(async () => {
    if (!signOut || isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      setIsOpen(false);
      setIsAddFormVisible(false);
      await signOut();
      navigate("/login");
    } catch (err) {
      console.error("Falha ao desconectar", err);
    } finally {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, navigate, signOut]);

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
    if (!isAddFormVisible) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        setIsAddFormVisible(false);
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
  }, [isAddFormVisible]);

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
      <label
        className="account-dropdown__label"
        htmlFor="account-select"
        onClick={() => { if (!isDisabled) setIsOpen((prev) => !prev); }}
        style={{ cursor: isDisabled ? 'default' : 'pointer' }}
      >
        Conta
      </label>
      {isDisabled ? (
        <div className="filter-select__empty" role="note">
          <span>Cadastre uma conta nas configuracoes.</span>
          <button
            type="button"
            className="account-dropdown__add-button"
            onClick={() => {
              setFormError("");
              setFormData(EMPTY_ACCOUNT_FORM);
              setIsAddFormVisible(true);
              setIsOpen(true);
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
              <AvatarWithFallback
                candidates={currentAccountDisplay.profilePictureCandidates}
                alt={currentAccount.label}
                imageClassName="account-dropdown__avatar"
                placeholderClassName="account-dropdown__avatar-placeholder"
                placeholderText={getAccountInitials(currentAccount?.label)}
              />
              <span
                className="account-dropdown__name"
                title={currentAccountLabel || undefined}
              >
                {currentAccountLabel}
              </span>
            </div>
            <ChevronDown size={16} className={`account-dropdown__icon${isOpen ? " account-dropdown__icon--open" : ""}`} />
          </button>

          {isOpen && (
            <div className="account-dropdown__list" role="listbox">
              {!isAddFormVisible ? (
                <>
                  {availableAccounts.map((account) => {
                    const accountDisplay = resolveAccountDisplay(account);
                    const accountLabel = accountDisplay.username || account.label || "";
                    return (
                      <div key={account.id} role="option" aria-selected={account.id === currentValue}>
                        <button
                          type="button"
                          className={`account-dropdown__item${account.id === currentValue ? " account-dropdown__item--active" : ""}`}
                          onClick={() => handleSelect(account.id)}
                        >
                          <AvatarWithFallback
                            candidates={accountDisplay.profilePictureCandidates}
                            alt={account.label}
                            imageClassName="account-dropdown__avatar"
                            placeholderClassName="account-dropdown__avatar-placeholder"
                            placeholderText={getAccountInitials(account.label)}
                          />
                          <span
                            className="account-dropdown__item-name"
                            title={accountLabel || undefined}
                          >
                            {accountLabel}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  <div className="account-dropdown__divider" role="presentation" />
                  <div role="presentation">
                    <button
                      type="button"
                      className="account-dropdown__add-button"
                      onClick={() => {
                        setFormError("");
                        setFormData(EMPTY_ACCOUNT_FORM);
                        setIsAddFormVisible(true);
                      }}
                    >
                      <Plus size={14} /> Adicionar conta
                    </button>
                  </div>
                  <div className="account-dropdown__divider" role="presentation" />
                  <div role="presentation">
                    <button
                      type="button"
                      className="account-dropdown__logout-button"
                      onClick={handleLogout}
                      disabled={!signOut || isLoggingOut}
                    >
                      <LogOut size={14} />
                      <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="account-dropdown__add-form">
                  <div className="account-dropdown__add-form-header">
                    <div>
                      <h3 className="account-dropdown__add-form-title">Adicionar conta</h3>
                      <p className="account-dropdown__add-form-subtitle">Use os mesmos dados da area de contas conectadas.</p>
                    </div>
                    <button
                      type="button"
                      className="account-dropdown__back-button"
                      onClick={() => {
                        if (!isSubmitting) {
                          setIsAddFormVisible(false);
                          setFormError("");
                        }
                      }}
                      aria-label="Voltar"
                      disabled={isSubmitting}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <form
                    className="account-dropdown__form"
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
                        setIsAddFormVisible(false);
                      } catch (err) {
                        pendingAccountRef.current = null;
                        setFormError(err?.message || "Nao foi possivel adicionar a conta.");
                      } finally {
                        clearTimeout(clearPendingTimeout);
                        setIsSubmitting(false);
                      }
                    }}
                  >
                    <div className="account-dropdown__form-field">
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
                        disabled={isSubmitting}
                      />
                    </div>

                    <div className="account-dropdown__form-field">
                      <label htmlFor="account-page-id-dropdown">ID da pagina</label>
                      <input
                        id="account-page-id-dropdown"
                        name="facebookPageId"
                        value={formData.facebookPageId}
                        onChange={(event) => {
                          setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                        }}
                        placeholder="1234567890"
                        disabled={isSubmitting}
                      />
                    </div>

                    <div className="account-dropdown__form-field">
                      <label htmlFor="account-ig-id-dropdown">ID Instagram</label>
                      <input
                        id="account-ig-id-dropdown"
                        name="instagramUserId"
                        value={formData.instagramUserId}
                        onChange={(event) => {
                          setFormData((prev) => ({ ...prev, [event.target.name]: event.target.value }));
                        }}
                        placeholder="1784..."
                        disabled={isSubmitting}
                      />
                    </div>

                    <div className="account-dropdown__form-field">
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
                        disabled={isSubmitting}
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
                          <p className="account-dropdown__form-hint">
                            Selecione uma conta descoberta ou digite manualmente.
                          </p>
                        </>
                      ) : null}
                    </div>

                    {formError && <p className="account-dropdown__form-error" role="alert">{formError}</p>}

                    <div className="account-dropdown__form-actions">
                      <button
                        type="button"
                        className="account-dropdown__form-button account-dropdown__form-button--secondary"
                        onClick={() => {
                          if (!isSubmitting) {
                            setIsAddFormVisible(false);
                            setFormError("");
                          }
                        }}
                        disabled={isSubmitting}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="account-dropdown__form-button account-dropdown__form-button--primary"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Salvando..." : "Adicionar"}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
