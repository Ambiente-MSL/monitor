import { fetchWithTimeout } from "./fetchWithTimeout";

const API_BASE_URL = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');

const buildUrl = (input) => {
  if (!input) {
    return API_BASE_URL || '/';
  }
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  const normalizedPath = input.startsWith('/') ? input : `/${input}`;
  if (!API_BASE_URL) {
    return normalizedPath;
  }
  return `${API_BASE_URL}${normalizedPath}`;
};

export const fetcher = (input, init) =>
  fetchWithTimeout(buildUrl(input), init).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });
