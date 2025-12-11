import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Facebook, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { buildLegalUrl } from '../lib/legalLinks';
import { useTranslation } from 'react-i18next';
import logoMsl from '../assets/logo-msl.svg';

const translateError = (rawMessage) => {
  if (!rawMessage) {
    return 'Não foi possível acessar sua conta. Verifique as credenciais.';
  }
  const normalized = String(rawMessage).toLowerCase();
  if (normalized.includes('invalid credentials')) {
    return 'Credenciais inválidas. Verifique os dados informados.';
  }
  if (normalized.includes('email') && normalized.includes('required')) {
    return 'Informe e-mail e senha para continuar.';
  }
  if (normalized.includes('network')) {
    return 'Falha de rede ao conectar. Tente novamente em instantes.';
  }
  return rawMessage;
};

const facebookAppId = process.env.REACT_APP_FACEBOOK_APP_ID;
const facebookConfigId = process.env.REACT_APP_FACEBOOK_CONFIG_ID;
const metaScopes = 'pages_read_engagement,pages_show_list,instagram_basic,email,public_profile';
const apiBaseUrl = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
const buildApiUrl = (path = '') => {
  if (!path) return apiBaseUrl || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl}${normalized}`;
};

const ensureFacebookSdk = () =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Ambiente de navegador não disponível.'));
      return;
    }
    if (window.FB) {
      resolve(window.FB);
      return;
    }

    window.fbAsyncInit = () => {
      try {
        window.FB.init({
          appId: facebookAppId,
          cookie: true,
          xfbml: false,
          version: 'v23.0',
        });
        resolve(window.FB);
      } catch (err) {
        reject(err);
      }
    };

    const existingScript = document.getElementById('facebook-jssdk');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.FB));
      existingScript.addEventListener('error', () => reject(new Error('Não foi possível carregar o SDK do Facebook.')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.FB) {
        resolve(window.FB);
      }
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK do Facebook.'));
    document.body.appendChild(script);
  });

export default function Login() {
  const { user, loading, signInWithPassword, signInWithFacebook } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);
  const [facebookReady, setFacebookReady] = useState(false);
  const [lang, setLang] = useState(i18n.language || 'pt');

  const redirectPath = useMemo(() => {
    const fromPath = location.state?.from?.pathname;
    if (!fromPath || fromPath === '/login') return '/';
    return fromPath;
  }, [location.state]);

  useEffect(() => {
    if (!loading && user) {
      navigate(redirectPath, { replace: true });
    }
  }, [loading, user, navigate, redirectPath]);

  const handleLangChange = useCallback(
    (next) => {
      const normalized = next === 'en' ? 'en' : 'pt';
      setLang(normalized);
      i18n.changeLanguage(normalized);
    },
    [i18n],
  );

  useEffect(() => {
    let cancelled = false;
    if (!facebookAppId) return undefined;

    ensureFacebookSdk()
      .then(() => {
        if (!cancelled) {
          setFacebookReady(true);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar SDK do Facebook', err);
        if (!cancelled) {
          setFacebookReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setFormError(translateError(err?.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFacebookLogin = async () => {
    setFormError('');
    if (!facebookAppId) {
      setFormError('Configuração do Facebook ausente. Defina REACT_APP_FACEBOOK_APP_ID.');
      return;
    }
    setFacebookLoading(true);
    try {
      const FB = await ensureFacebookSdk();
      const accessToken = await new Promise((resolve, reject) => {
        const options = facebookConfigId
          ? { config_id: facebookConfigId, scope: metaScopes, return_scopes: true }
          : { scope: metaScopes, return_scopes: true };

        FB.login(
          (response) => {
            if (response?.authResponse?.accessToken) {
              resolve(response.authResponse.accessToken);
            } else if (response?.status === 'not_authorized') {
              reject(new Error('Permissão do Facebook não autorizada.'));
            } else {
              reject(new Error('Login com Facebook cancelado ou não disponível.'));
            }
          },
          options,
        );
      });

      const loginResponse = await signInWithFacebook(accessToken);

      // Passo opcional: registrar o token com scopes aprovados para armazenar page/IG token sem quebrar o login anterior
      const sessionToken = loginResponse?.token;
      if (sessionToken) {
        try {
          const persistResponse = await fetch(buildApiUrl('/api/auth/meta-token'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ access_token: accessToken }),
          });
          if (!persistResponse.ok) {
            const body = await persistResponse.json().catch(() => ({}));
            const message = body?.error || `Falha ao salvar token Meta (${persistResponse.status})`;
            console.warn(message);
          }
        } catch (err) {
          console.warn('Falha ao persistir token de página/IG no backend.', err);
        }
      }

      navigate(redirectPath, { replace: true });
    } catch (err) {
      setFormError(translateError(err?.message));
    } finally {
      setFacebookLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-lang-selector">
        <span className="auth-lang-flag">{lang === 'pt' ? '🇧🇷' : '🇺🇸'}</span>
        <select
          id="lang-select"
          value={lang}
          onChange={(e) => handleLangChange(e.target.value)}
        >
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="auth-container">
        <div className="auth-left">
          <img src={logoMsl} alt="MSL Estratégia" className="auth-logo" />
          <p className="auth-subtext-left">{t('login.no_account')}</p>
          <Link className="auth-register-btn" to="/register">
            {t('login.create_account')}
          </Link>
        </div>

        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-heading">{t('login.title')}</h1>
          </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="email">{t('login.email')}</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('login.email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting}
          />
          <div className="auth-label-row">
            <label className="auth-label" htmlFor="password">{t('login.password')}</label>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder={t('login.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={submitting}
          />
          {formError && <p className="auth-error">{formError}</p>}
          <button type="submit" className="auth-submit" disabled={submitting}>
            <LogIn size={16} />
            {submitting ? t('login.submit_loading') : t('login.submit')}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1.25rem 10% 0.75rem 10%' }}>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>{t('login.or')}</span>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e5e7eb' }} />
        </div>

        <button
          type="button"
          className="auth-submit"
          style={{
            backgroundColor: '#0866ff',
            borderColor: '#0653d9',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            justifyContent: 'center',
          }}
          onClick={handleFacebookLogin}
          disabled={submitting || facebookLoading || (facebookAppId && !facebookReady)}
        >
          <Facebook size={16} />
          {facebookLoading
            ? t('login.fb_loading')
            : !facebookReady && facebookAppId
              ? t('login.fb_loading_sdk')
              : t('login.fb')}
        </button>

          <div className="auth-footer">
            <a
              href={buildLegalUrl('/legal/terms-of-service.html')}
              className="auth-link"
              style={{ color: '#223A3A' }}
              target="_blank"
              rel="noreferrer"
            >
              {t('login.legal_terms')}
            </a>
            <a
              href={buildLegalUrl('/legal/privacy-policy.html')}
              className="auth-link"
              style={{ color: '#223A3A' }}
              target="_blank"
              rel="noreferrer"
            >
              {t('login.legal_privacy')}
            </a>
            <a
              href={buildLegalUrl('/legal/privacy-policy-en.html')}
              className="auth-link"
              style={{ color: '#223A3A' }}
              target="_blank"
              rel="noreferrer"
            >
              {t('login.legal_privacy_en')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
