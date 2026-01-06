import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import useQueryState from "../hooks/useQueryState";
import { useAccounts } from "../context/AccountsContext";
import { DEFAULT_ACCOUNTS } from "../data/accounts";
import { unwrapApiData } from "../lib/apiEnvelope";

const FALLBACK_ACCOUNT_ID = DEFAULT_ACCOUNTS[0]?.id || "";
const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

export default function AccountSelect() {
  const { accounts, loading } = useAccounts();
  const availableAccounts = accounts.length ? accounts : DEFAULT_ACCOUNTS;
  const [get, set] = useQueryState({ account: FALLBACK_ACCOUNT_ID });
  const queryAccount = get("account");
  const [isOpen, setIsOpen] = useState(false);
  const [accountsData, setAccountsData] = useState({});
  const dropdownRef = useRef(null);

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
        const resp = await fetch(url);
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

  return (
    <div className="account-dropdown" ref={dropdownRef}>
      <label className="account-dropdown__label" htmlFor="account-select">Conta</label>
      {isDisabled ? (
        <div className="filter-select__empty" role="note">
          Cadastre uma conta nas configuracoes.
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
            </ul>
          )}
        </>
      )}
    </div>
  );
}
