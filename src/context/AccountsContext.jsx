import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import { createDefaultAccounts } from "../data/accounts";
import { useAuth } from "./AuthContext";

const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");
const DISCOVER_ACCOUNTS_ENDPOINT = `${API_BASE_URL || ""}/api/accounts/discover`;
const MANAGED_ACCOUNTS_ENDPOINT = `${API_BASE_URL || ""}/api/accounts`;

const AccountsContext = createContext(null);

const ensureAdAccountId = (value) => {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const cleaned = raw.replace(/^act_?/i, "");
  return cleaned ? `act_${cleaned}` : "";
};

function normalizeAccount(raw, existing = []) {
  if (!raw) return null;
  const {
    id,
    label,
    facebookPageId,
    instagramUserId,
    adAccountId,
    instagramUsername,
    adAccounts,
    source,
  } = raw;
  if (!label) return null;
  const normalized = {
    id: String(id || generateAccountId(label, existing)).trim(),
    label: String(label).trim(),
    facebookPageId: String(facebookPageId || "").trim(),
    instagramUserId: String(instagramUserId || "").trim(),
    adAccountId: ensureAdAccountId(adAccountId),
  };
  const profilePictureSource = raw.profilePictureUrl ?? raw.profile_picture_url;
  if (profilePictureSource) {
    normalized.profilePictureUrl = String(profilePictureSource).trim();
  }
  if (instagramUsername) {
    normalized.instagramUsername = String(instagramUsername).trim();
  }
  const pagePictureSource = raw.pagePictureUrl ?? raw.page_picture_url;
  if (pagePictureSource) {
    normalized.pagePictureUrl = String(pagePictureSource).trim();
  }
  if (Array.isArray(adAccounts)) {
    const normalizedAds = adAccounts
      .map((ad) => {
        if (!ad) return null;
        const adIdRaw = ad.id != null ? String(ad.id).trim() : "";
        const accountIdRaw = ad.accountId ?? ad.account_id;
        const baseId = adIdRaw || (accountIdRaw != null ? String(accountIdRaw).trim() : "");
        const adId = ensureAdAccountId(baseId);
        if (!adId) return null;
        return {
          id: adId,
          name: ad.name != null ? String(ad.name).trim() : "",
          accountStatus: ad.accountStatus ?? null,
          currency: ad.currency != null ? String(ad.currency).trim() : "",
          timezoneName: ad.timezoneName != null ? String(ad.timezoneName).trim() : "",
        };
      })
      .filter(Boolean);
    if (normalizedAds.length) {
      normalized.adAccounts = normalizedAds;
      if (!normalized.adAccountId) {
        normalized.adAccountId = normalizedAds[0].id;
      }
    }
  }
  if (source) {
    normalized.source = String(source).trim();
  }
  return normalized;
}

function generateAccountId(label, existing = []) {
  const base = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fallback = base || "account";
  let candidate = fallback;
  let counter = 1;
  const ids = new Set(existing.map((acc) => acc.id));
  while (ids.has(candidate)) {
    candidate = `${fallback}-${counter++}`;
  }
  return candidate;
}

export function AccountsProvider({ children }) {
  const [accounts, setAccounts] = useState(() => createDefaultAccounts());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { apiFetch, token } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined" || typeof fetch !== "function") {
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const discoverAccounts = async () => {
      setLoading(true);
      setError("");
      // 1) Contas persistidas (manuais)
      if (token) {
        try {
          const savedBody = await apiFetch(MANAGED_ACCOUNTS_ENDPOINT);
          const rawSaved = Array.isArray(savedBody?.accounts) ? savedBody.accounts : [];
          const normalizedSaved = [];
          for (const item of rawSaved) {
            const account = normalizeAccount({ ...item, source: item.source || "manual" }, normalizedSaved);
            if (account) normalizedSaved.push(account);
          }
          if (!cancelled && normalizedSaved.length) {
            setAccounts((prev) => {
              const merged = [...prev];
              const ids = new Set(merged.map((acc) => acc.id));
              normalizedSaved.forEach((acc) => {
                if (!ids.has(acc.id)) {
                  merged.push(acc);
                  ids.add(acc.id);
                }
              });
              return merged;
            });
          }
        } catch (err) {
          if (!cancelled) {
            setError("Falha ao carregar contas salvas.");
          }
        }
      }

      // 2) Descobrir contas do token
      try {
        const response = await fetchWithTimeout(DISCOVER_ACCOUNTS_ENDPOINT, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const body = await response.json();
        const rawList = Array.isArray(body?.accounts) ? body.accounts : [];
        if (!rawList.length || cancelled) {
          if (!cancelled) {
            setLoading(false);
          }
          return;
        }

        const discovered = [];
        for (const item of rawList) {
          const account = normalizeAccount({ ...item, source: "meta" }, discovered);
          if (account) {
            discovered.push(account);
          }
        }
        const persisted = Array.isArray(body?.persistedAccounts) ? body.persistedAccounts : [];
        for (const item of persisted) {
          const account = normalizeAccount({ ...item, source: item.source || "manual" }, discovered);
          if (account) {
            discovered.push(account);
          }
        }

        if (!discovered.length || cancelled) {
          if (!cancelled) {
            setLoading(false);
          }
          return;
        }

        setAccounts((prev) => {
          const next = [...prev];
          const indexByPageId = new Map();
          next.forEach((account, index) => {
            if (account?.facebookPageId) {
              indexByPageId.set(account.facebookPageId, index);
            }
          });

          discovered.forEach((metaAccount) => {
            const pageId = metaAccount.facebookPageId;
            if (!pageId) return;

            const existingIndex = indexByPageId.get(pageId);
            if (existingIndex != null) {
              const current = next[existingIndex];
              const merged = {
                ...current,
                label: metaAccount.label || current.label,
                facebookPageId: metaAccount.facebookPageId || current.facebookPageId,
                instagramUserId: metaAccount.instagramUserId || current.instagramUserId,
                adAccountId: metaAccount.adAccountId || current.adAccountId,
                id: current.id || metaAccount.id || generateAccountId(metaAccount.label, next),
              };
              if (metaAccount.instagramUsername) {
                merged.instagramUsername = metaAccount.instagramUsername;
              }
              if (metaAccount.adAccounts) {
                merged.adAccounts = metaAccount.adAccounts;
              }
              if (metaAccount.profilePictureUrl) {
                merged.profilePictureUrl = metaAccount.profilePictureUrl;
              }
              if (metaAccount.pagePictureUrl) {
                merged.pagePictureUrl = metaAccount.pagePictureUrl;
              }
              merged.source = current.source || metaAccount.source;

              const previousSnapshot = JSON.stringify(current);
              const nextSnapshot = JSON.stringify(merged);
              if (previousSnapshot !== nextSnapshot) {
                next[existingIndex] = merged;
              }
            } else {
              const candidateId = metaAccount.id || generateAccountId(metaAccount.label, next);
              const newAccount = {
                ...metaAccount,
                id: candidateId,
              };
              next.push(newAccount);
              indexByPageId.set(pageId, next.length - 1);
            }
          });

          return next.length ? next : prev;
        });
        setLoading(false);
      } catch (error) {
        if (cancelled || error.name === "AbortError") {
          return;
        }
        console.warn("Falha ao descobrir contas automaticamente.", error);
        setError(isTimeoutError(error) ? "Tempo esgotado ao descobrir contas." : "Falha ao descobrir contas automaticamente.");
        setLoading(false);
      }
    };

    discoverAccounts();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiFetch, token]);

  const addAccount = async (payload) => {
    const body = {
      label: payload.label.trim(),
      facebookPageId: payload.facebookPageId.trim(),
      instagramUserId: payload.instagramUserId.trim(),
      adAccountId: ensureAdAccountId(payload.adAccountId),
      profilePictureUrl: payload.profilePictureUrl ? payload.profilePictureUrl.trim() : "",
      pagePictureUrl: payload.pagePictureUrl ? payload.pagePictureUrl.trim() : "",
    };
    try {
      const data = await apiFetch(MANAGED_ACCOUNTS_ENDPOINT, {
        method: "POST",
        body,
      });
      const account = normalizeAccount(data?.account);
      if (!account) return;
      setAccounts((prev) => {
        const next = [...prev];
        const idx = next.findIndex((acc) => acc.facebookPageId === account.facebookPageId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...account };
        } else {
          next.push(account);
        }
        return next;
      });
    } catch (err) {
      console.warn("Falha ao adicionar conta no backend, mantendo local.", err);
      setAccounts((prev) => [...prev, { ...body, id: generateAccountId(body.label, prev) }]);
    }
  };

  const updateAccount = async (id, payload) => {
    const body = {
      label: payload.label.trim(),
      facebookPageId: payload.facebookPageId.trim(),
      instagramUserId: payload.instagramUserId.trim(),
      adAccountId: ensureAdAccountId(payload.adAccountId),
      profilePictureUrl: payload.profilePictureUrl ? payload.profilePictureUrl.trim() : "",
      pagePictureUrl: payload.pagePictureUrl ? payload.pagePictureUrl.trim() : "",
    };
    try {
      const data = await apiFetch(`${MANAGED_ACCOUNTS_ENDPOINT}/${id}`, {
        method: "PUT",
        body,
      });
      const account = normalizeAccount(data?.account);
      if (!account) return;
      setAccounts((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...account } : item)),
      );
    } catch (err) {
      console.warn("Falha ao atualizar conta no backend.", err);
    }
  };

  const removeAccount = async (id) => {
    try {
      const resp = await apiFetch(`${MANAGED_ACCOUNTS_ENDPOINT}/${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("Falha ao remover conta no backend.", err);
    }
    setAccounts((prev) => {
      const next = prev.filter((account) => account.id !== id);
      return next.length ? next : createDefaultAccounts();
    });
  };

  const value = useMemo(
    () => ({
      accounts,
      loading,
      error,
      addAccount,
      updateAccount,
      removeAccount,
    }),
    [accounts, loading, error],
  );

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts() {
  const context = useContext(AccountsContext);
  if (!context) {
    throw new Error("useAccounts deve ser utilizado dentro de AccountsProvider");
  }
  return context;
}
