import { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { createPortal } from "react-dom";
import "./App.css";
import deenCoreIcon from "./assets/logo-icon.svg";

// ─── API Base URL ──────────────────────────────────────────
// Production (Vercel + Render split): set VITE_API_URL to the Render backend URL.
// Same-origin deploy: leave VITE_API_URL empty; backend serves dist/ on the same host.
// Dev: Vite on :5173 talks to Express on :3001 automatically.
const RAW_API_BASE =
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : '');
const API_BASE = (RAW_API_BASE || '').replace(/\/+$/, '');

// ═══════════════════════════════════════════════════════════
// MOCK AUTH DATABASE (simulated — stored in localStorage)
// ═══════════════════════════════════════════════════════════
const MOCK_DB_KEY  = 'qf_mock_userdb';
const SESSION_KEY  = 'qf_session';

function loadDB() {
  try { return JSON.parse(localStorage.getItem(MOCK_DB_KEY)) || { users: [] }; }
  catch { return { users: [] }; }
}
function saveDB(db) { localStorage.setItem(MOCK_DB_KEY, JSON.stringify(db)); }
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function saveSession(user) { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

// Simple deterministic hash — NOT for production, demo only
function simHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return 'h_' + Math.abs(h).toString(36);
}
function genId() { return 'usr_' + Math.random().toString(36).slice(2, 10); }

function dbSignUp(name, email, password) {
  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.provider === 'email')) {
    return { error: 'An account with this email already exists.' };
  }
  const user = { id: genId(), name, email: email.toLowerCase(), hash: simHash(password), provider: 'email', avatar: null, createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  const session = { id: user.id, name: user.name, email: user.email, provider: 'email', avatar: null };
  saveSession(session);
  return { user: session };
}

function dbSignIn(email, password) {
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.provider === 'email');
  if (!user) return { error: 'No account found with this email.' };
  if (user.hash !== simHash(password)) return { error: 'Incorrect password.' };
  const session = { id: user.id, name: user.name, email: user.email, provider: 'email', avatar: null };
  saveSession(session);
  return { user: session };
}

function dbSocialLogin(provider, email, name) {
  const db = loadDB();
  let user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.provider === provider);
  if (!user) {
    user = { id: genId(), name, email: email.toLowerCase(), hash: null, provider, avatar: null, createdAt: new Date().toISOString() };
    db.users.push(user);
    saveDB(db);
  }
  const session = { id: user.id, name: user.name, email: user.email, provider, avatar: null };
  saveSession(session);
  return { user: session };
}

function dbGuestLogin() {
  const session = { id: 'guest_' + Math.random().toString(36).slice(2, 8), name: 'Guest', email: null, provider: 'guest', avatar: null };
  saveSession(session);
  return { user: session };
}

// ═══════════════════════════════════════════════════════════
// READING TIMER & STREAK (localStorage key: qf_reading)
// ═══════════════════════════════════════════════════════════
const READING_KEY = 'qf_reading';
const DAILY_GOAL_KEY = 'dailyGoal';
const DAILY_GOAL_PROFILE_KEY = 'dailyGoalProfile';
const DAILY_GOAL_LEVELS = [1, 2, 3, 4, 5, 7, 10];
const DAILY_GOAL_PROMOTION_STREAK = 2;

function loadReading() {
  try { return JSON.parse(localStorage.getItem(READING_KEY)) || {}; } catch { return {}; }
}
function saveReading(d) { localStorage.setItem(READING_KEY, JSON.stringify(d)); }
function recordReadingMinutes(minutes) {
  recordReadingSeconds(Math.max(0, Math.round(minutes * 60)));
}
function recordReadingSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const today = new Date().toDateString();
  const d = loadReading();
  const historySeconds = d.historySeconds || {};
  historySeconds[today] = (historySeconds[today] || 0) + Math.round(seconds);
  saveReading({ ...d, historySeconds });
}
function getTodaySeconds() {
  const today = new Date().toDateString();
  const d = loadReading();
  const legacyMinutes = (d.history || {})[today] || 0;
  const trackedSeconds = (d.historySeconds || {})[today] || 0;
  return Math.max(0, trackedSeconds + Math.round(legacyMinutes * 60));
}
function getReadingStreak() {
  const d = loadReading();
  const history = d.history || {};
  const historySeconds = d.historySeconds || {};
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const key = day.toDateString();
    if ((history[key] || 0) > 0 || (historySeconds[key] || 0) > 0) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// ─── Recently Visited Surahs ───────────────────────────────
function loadRecentSurahs() {
  try { return JSON.parse(localStorage.getItem('recentSurahs')) || []; } catch { return []; }
}
function recordVisitedSurah(id, name) {
  const recent = loadRecentSurahs().filter(s => s.id !== id);
  recent.unshift({ id, name });
  localStorage.setItem('recentSurahs', JSON.stringify(recent.slice(0, 5)));
}

function getDailyGoalTarget(levelIndex) {
  const safeIndex = Math.max(0, Math.min(DAILY_GOAL_LEVELS.length - 1, Number(levelIndex) || 0));
  return DAILY_GOAL_LEVELS[safeIndex];
}

function loadDailyGoalProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(DAILY_GOAL_PROFILE_KEY) || '{}');
    const safeLevel = Math.max(0, Math.min(DAILY_GOAL_LEVELS.length - 1, Number(profile.levelIndex) || 0));
    return {
      levelIndex: safeLevel,
      masteryStreak: Math.max(0, Number(profile.masteryStreak) || 0),
      completedDays: Math.max(0, Number(profile.completedDays) || 0),
    };
  } catch {
    return { levelIndex: 0, masteryStreak: 0, completedDays: 0 };
  }
}

function saveDailyGoalProfile(profile) {
  localStorage.setItem(DAILY_GOAL_PROFILE_KEY, JSON.stringify(profile));
}

function loadDailyGoalState() {
  try { return JSON.parse(localStorage.getItem(DAILY_GOAL_KEY) || '{}'); } catch { return {}; }
}

function saveDailyGoalState(state) {
  localStorage.setItem(DAILY_GOAL_KEY, JSON.stringify(state));
}

function createDailyGoalState(date, target) {
  return { date, read: 0, target, counted: {}, completed: false };
}

function ensureDailyGoalState() {
  const today = new Date().toDateString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toDateString();

  const profile = loadDailyGoalProfile();
  const target = getDailyGoalTarget(profile.levelIndex);
  let state = loadDailyGoalState();

  if (state.date !== today) {
    if (state.date === yesterday && !state.completed && profile.masteryStreak > 0) {
      profile.masteryStreak = 0;
      saveDailyGoalProfile(profile);
    }
    state = createDailyGoalState(today, target);
    saveDailyGoalState(state);
    return { state, profile };
  }

  state = {
    date: state.date,
    read: Math.max(0, Number(state.read) || 0),
    target: Math.max(1, Number(state.target) || target),
    counted: state.counted && typeof state.counted === 'object' ? state.counted : {},
    completed: Boolean(state.completed) || (Number(state.read) || 0) >= (Number(state.target) || target),
  };
  saveDailyGoalState(state);
  return { state, profile };
}

function recordDailyGoalProgress(surahId) {
  try {
    const { state, profile } = ensureDailyGoalState();
    const key = String(surahId);
    if (state.counted?.[key]) return state;

    state.counted = { ...(state.counted || {}), [key]: true };
    state.read = (state.read || 0) + 1;

    if (!state.completed && state.read >= state.target) {
      state.completed = true;
      profile.masteryStreak = (profile.masteryStreak || 0) + 1;
      profile.completedDays = (profile.completedDays || 0) + 1;
      if (profile.masteryStreak >= DAILY_GOAL_PROMOTION_STREAK && profile.levelIndex < DAILY_GOAL_LEVELS.length - 1) {
        profile.levelIndex += 1;
        profile.masteryStreak = 0;
      }
      saveDailyGoalProfile(profile);
    }

    saveDailyGoalState(state);
    return state;
  } catch {
    return null;
  }
}

// ─── Auth Context ──────────────────────────────────────────
const AuthContext = createContext();
const useAuth = () => useContext(AuthContext);

// Social provider mock accounts (simulates OAuth "choose account")
const SOCIAL_ACCOUNTS = {
  google:    [{ email: 'you@gmail.com', name: 'You (Gmail)', avatar: 'G' }, { email: 'demo@gmail.com', name: 'Demo User', avatar: 'G' }],
  microsoft: [{ email: 'you@outlook.com', name: 'You (Outlook)', avatar: 'M' }, { email: 'demo@hotmail.com', name: 'Demo User', avatar: 'M' }],
  apple:     [{ email: 'you@icloud.com', name: 'You (Apple ID)', avatar: '' }],
  github:    [{ email: 'you@github.com', name: 'GitHub User', avatar: '' }],
};
const SOCIAL_LABELS = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple', github: 'GitHub' };
const SOCIAL_COLORS = { google: '#EA4335', microsoft: '#00A4EF', apple: '#000', github: '#24292e' };


const defaultSettings = {
  theme: 'dark-navy',
  scriptStyle: 'uthmani',
  globalTextScale: 1,
  arabicSize: 2.4,
  arabicLineHeight: 2.2,
  translationSize: 1.05,
  translationLineHeight: 1.8,
  showTranslation: true,
  showAyahBadges: true,
  wordByWord: false,
  tajweedMode: false,
  viewMode: 'card',
  spacing: 'normal',
  layoutMode: 'wide',
  translationId: 85,
  customAccent: '',
};

const VALID_TRANSLATION_IDS = [84, 85, 57, 234, 161, 80, 39, 33, 78, 208, 136, 140];
const VALID_THEMES = ['dark-navy', 'light'];
const VALID_SCRIPT_STYLES = ['uthmani', 'indopak', 'simple', 'naskh'];
const VALID_VIEW_MODES = ['card', 'flat'];
const VALID_SPACING = ['tight', 'normal', 'spacious'];
const VALID_LAYOUTS = ['wide'];

const normalizeNumber = (value, fallback) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeHexColor = (value) => {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(cleaned)) return '';
  return `#${cleaned}`;
};

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const v = normalized.slice(1);
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
};

const rgbCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;
const rgbaCss = ({ r, g, b }, a) => `rgba(${r}, ${g}, ${b}, ${a})`;
const clampRgb = ({ r, g, b }) => ({
  r: Math.max(0, Math.min(255, Math.round(r))),
  g: Math.max(0, Math.min(255, Math.round(g))),
  b: Math.max(0, Math.min(255, Math.round(b))),
});

const mixRgb = (a, b, t) => clampRgb({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

const srgbToLinear = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (rgb) => {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (c1, c2) => {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const tuneColorForContrast = (base, background, minContrast = 4.5) => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  if (contrastRatio(base, background) >= minContrast) return base;

  const towardWhite = contrastRatio(white, background) > contrastRatio(black, background);
  const target = towardWhite ? white : black;

  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const candidate = mixRgb(base, target, t);
    if (contrastRatio(candidate, background) >= minContrast) {
      return candidate;
    }
  }

  return target;
};

const isCustomAccentLight = (customAccent) => {
  const accent = hexToRgb(customAccent);
  if (!accent) return false;
  const perceivedBrightness = (accent.r * 299 + accent.g * 587 + accent.b * 114) / 1000;
  return perceivedBrightness > 140;
};

const buildCustomThemeStyle = (customAccent, preferredMode = 'auto') => {
  const accent = hexToRgb(customAccent);
  if (!accent) return null;

  const isLightAccent = isCustomAccentLight(customAccent);
  const isLightMode = preferredMode === 'light' ? true : preferredMode === 'dark' ? false : isLightAccent;

  const bgPrimary = isLightMode
    ? mixRgb(accent, { r: 255, g: 255, b: 255 }, isLightAccent ? 0.9 : 0.95)
    : mixRgb(accent, { r: 0, g: 0, b: 0 }, isLightAccent ? 0.9 : 0.86);
  const bgSecondary = isLightMode
    ? mixRgb(accent, { r: 255, g: 255, b: 255 }, isLightAccent ? 0.84 : 0.9)
    : mixRgb(accent, { r: 0, g: 0, b: 0 }, isLightAccent ? 0.82 : 0.76);
  const bgTertiary = isLightMode
    ? mixRgb(accent, { r: 255, g: 255, b: 255 }, isLightAccent ? 0.94 : 0.97)
    : mixRgb(accent, { r: 0, g: 0, b: 0 }, isLightAccent ? 0.76 : 0.68);

  const idealPrimary = contrastRatio({ r: 255, g: 255, b: 255 }, bgPrimary) >= contrastRatio({ r: 0, g: 0, b: 0 }, bgPrimary)
    ? { r: 255, g: 255, b: 255 }
    : { r: 0, g: 0, b: 0 };

  const textPrimary = tuneColorForContrast(idealPrimary, bgPrimary, 7);
  const textSecondaryBase = mixRgb(textPrimary, bgPrimary, 0.2);
  const textSecondary = tuneColorForContrast(textSecondaryBase, bgPrimary, 5);

  const accentColor = tuneColorForContrast(accent, bgPrimary, 3.2);
  const accentHover = tuneColorForContrast(
    mixRgb(accentColor, idealPrimary, idealPrimary.r === 255 ? 0.18 : 0.25),
    bgPrimary,
    3.2,
  );

  return {
    '--bg-primary': rgbCss(bgPrimary),
    '--bg-secondary': rgbaCss(bgSecondary, isLightMode ? 0.9 : 0.72),
    '--bg-tertiary': rgbaCss(bgTertiary, isLightMode ? 0.95 : 0.64),
    '--bg-hover': rgbaCss(tuneColorForContrast(accent, bgPrimary, 3), 0.14),
    '--text-primary': rgbCss(textPrimary),
    '--text-secondary': rgbCss(textSecondary),
    '--accent': rgbCss(accentColor),
    '--accent-hover': rgbCss(accentHover),
    '--border': rgbaCss(tuneColorForContrast(mixRgb(accentColor, bgPrimary, 0.28), bgPrimary, 2.2), 0.42),
    '--border-hover': rgbaCss(tuneColorForContrast(mixRgb(accentColor, bgPrimary, 0.18), bgPrimary, 2.4), 0.62),
    '--nav-bg': isLightMode ? 'rgba(255, 255, 255, 0.94)' : rgbaCss(mixRgb(accent, { r: 0, g: 0, b: 0 }, 0.9), 0.94),
    '--nav-border': rgbaCss(tuneColorForContrast(mixRgb(accentColor, bgPrimary, 0.22), bgPrimary, 2.3), isLightMode ? 0.24 : 0.2),
    '--chrome-control-bg': isLightMode ? 'rgba(255, 255, 255, 0.94)' : rgbaCss(bgSecondary, 0.58),
    '--chrome-control-border': rgbaCss(tuneColorForContrast(mixRgb(accentColor, bgPrimary, 0.2), bgPrimary, 2.2), isLightMode ? 0.32 : 0.35),
    '--chrome-control-shadow': isLightMode
      ? '0 6px 20px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92)'
      : '0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
    '--bg-gradient-end': rgbCss(isLightMode ? mixRgb(accent, { r: 255, g: 255, b: 255 }, 0.82) : mixRgb(accent, { r: 0, g: 0, b: 0 }, 0.8)),
    '--shadow-card': isLightMode ? '0 8px 24px rgba(0, 0, 0, 0.1)' : '0 8px 32px rgba(0, 0, 0, 0.3)',
    '--shadow-hover': isLightMode ? '0 12px 32px rgba(0, 0, 0, 0.16)' : '0 16px 48px rgba(0, 0, 0, 0.38)',
  };
};

const CUSTOM_THEME_SWATCHES = [
  '#2F8FFF', '#00B894', '#12B76A', '#F59E0B', '#EF4444', '#E11D48',
  '#7C3AED', '#2563EB', '#0D9488', '#A16207', '#4F46E5', '#475569',
];

const normalizeSettings = (raw = {}) => {
  const merged = { ...defaultSettings, ...(raw || {}) };

  return {
    ...merged,
    theme: VALID_THEMES.includes(merged.theme) ? merged.theme : defaultSettings.theme,
    scriptStyle: VALID_SCRIPT_STYLES.includes(merged.scriptStyle) ? merged.scriptStyle : defaultSettings.scriptStyle,
    viewMode: VALID_VIEW_MODES.includes(merged.viewMode) ? merged.viewMode : defaultSettings.viewMode,
    spacing: VALID_SPACING.includes(merged.spacing) ? merged.spacing : defaultSettings.spacing,
    layoutMode: VALID_LAYOUTS.includes(merged.layoutMode) ? merged.layoutMode : defaultSettings.layoutMode,
    translationId: VALID_TRANSLATION_IDS.includes(Number(merged.translationId)) ? Number(merged.translationId) : defaultSettings.translationId,
    globalTextScale: normalizeNumber(merged.globalTextScale, defaultSettings.globalTextScale),
    arabicSize: normalizeNumber(merged.arabicSize, defaultSettings.arabicSize),
    arabicLineHeight: normalizeNumber(merged.arabicLineHeight, defaultSettings.arabicLineHeight),
    translationSize: normalizeNumber(merged.translationSize, defaultSettings.translationSize),
    translationLineHeight: normalizeNumber(merged.translationLineHeight, defaultSettings.translationLineHeight),
    showTranslation: typeof merged.showTranslation === 'boolean' ? merged.showTranslation : defaultSettings.showTranslation,
    showAyahBadges: typeof merged.showAyahBadges === 'boolean' ? merged.showAyahBadges : defaultSettings.showAyahBadges,
    wordByWord: typeof merged.wordByWord === 'boolean' ? merged.wordByWord : defaultSettings.wordByWord,
    tajweedMode: typeof merged.tajweedMode === 'boolean' ? merged.tajweedMode : defaultSettings.tajweedMode,
    customAccent: normalizeHexColor(merged.customAccent) || defaultSettings.customAccent,
  };
};


const SettingsContext = createContext();

function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('appSettings');
      const parsed = saved ? JSON.parse(saved) : null;
      return normalizeSettings(parsed);
    } catch {
      return defaultSettings;
    }
  });

  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      const migrationKey = 'translationDefaultMigrated_85_v2';
      if (localStorage.getItem(migrationKey)) return;
      setSettings(prev => prev.translationId === 84 ? { ...prev, translationId: 85 } : prev);
      localStorage.setItem(migrationKey, '1');
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const migrationKey = 'scriptDefaultMigrated_uthmani';
      if (localStorage.getItem(migrationKey)) return;
      setSettings(prev => prev.scriptStyle === 'indopak' ? { ...prev, scriptStyle: 'uthmani' } : prev);
      localStorage.setItem(migrationKey, '1');
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
  }, [settings]);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const resetSection = (keys) => {
    setSettings(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = defaultSettings[k]; });
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, resetSection, showSettings, setShowSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

function useSettings() {
  return useContext(SettingsContext);
}

// ─── SVG Icons ─────────────────────────────────────────────

const IconBook = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const IconClock = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconMoon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </svg>
);

const IconSun = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M4.93 4.93l1.41 1.41" />
    <path d="M17.66 17.66l1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M4.93 19.07l1.41-1.41" />
    <path d="M17.66 6.34l1.41-1.41" />
  </svg>
);

const IconBookmark = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const IconCompass = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const IconStar = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconTarget = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const IconPlay = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const IconChevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconGear = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);

const IconHome = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const IconQuran = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const IconPrayer = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconExplore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const IconMapPin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const IconSearchSmall = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconMasjid = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18" />
    <path d="M5 21V12" />
    <path d="M19 21V12" />
    <path d="M5 12a7 7 0 0 1 14 0" />
    <line x1="12" y1="5" x2="12" y2="2" />
    <path d="M9 21v-3a3 3 0 0 1 6 0v3" />
  </svg>
);

const IconFood = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3v7a2 2 0 0 0 2 2h1v9" />
    <path d="M8 3v7" />
    <path d="M12 3v7" />
    <path d="M18 3v8a2 2 0 0 1-2 2h-1v8" />
  </svg>
);

// ─── Ayah Action Icons ─────────────────────────────────────

const IconBookmarkFill = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const IconPlaySmall = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const IconPause = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const IconCopy = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconShare = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const IconTafsir = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconFullscreen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

const IconExitFullscreen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
  </svg>
);

const IconSidebarLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M10 8l-4 4 4 4" />
  </svg>
);

const IconSidebarRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M14 8l4 4-4 4" />
  </svg>
);

const IconSearchLarge = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconDice = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="3" ry="3"/>
    <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
    <circle cx="16" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="8" cy="16" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  </svg>
);

const IconFire = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2c0 0-5 4.5-5 10a5 5 0 0 0 10 0C17 6.5 12 2 12 2zm0 15a3 3 0 0 1-3-3c0-2.5 3-6 3-6s3 3.5 3 6a3 3 0 0 1-3 3z"/>
  </svg>
);

const IconTimer = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="13" r="8"/>
    <polyline points="12 9 12 13 15 14"/>
    <path d="M9 3h6"/>
    <path d="M12 3v2"/>
  </svg>
);

const IconDragHandle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
    <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
  </svg>
);

// ─── Explore Topic Icons ──────────────────────────────────

const IconPatience = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const IconGratitude = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const IconHardship = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const IconSuccess = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
    <path d="M12 3v12" />
    <path d="M5 21h14" />
    <circle cx="12" cy="3" r="1" fill="currentColor" />
  </svg>
);

const IconPrayerTopic = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L9 9l-7 1 5 5-1.5 7L12 18.5 18.5 22 17 15l5-5-7-1z" />
  </svg>
);

const IconMercy = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <path d="M9 9h.01M15 9h.01" />
  </svg>
);

const IconTrust = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11.5 14.5 15 10" />
  </svg>
);

const IconForgiveness = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    <path d="M15 5l4 4" />
  </svg>
);

const TOPIC_ICONS = {
  patience: IconPatience,
  gratitude: IconGratitude,
  hardship: IconHardship,
  success: IconSuccess,
  prayer: IconPrayerTopic,
  mercy: IconMercy,
  trust: IconTrust,
  forgiveness: IconForgiveness,
};

// ─── Prayer Times Scaffold Data ───────────────────────────

const WORLD_CITIES = [
  { id: 'mecca', name: 'Mecca', country: 'Saudi Arabia', tz: 'Asia/Riyadh' },
  { id: 'medina', name: 'Medina', country: 'Saudi Arabia', tz: 'Asia/Riyadh' },
  { id: 'riyadh', name: 'Riyadh', country: 'Saudi Arabia', tz: 'Asia/Riyadh' },
  { id: 'dubai', name: 'Dubai', country: 'UAE', tz: 'Asia/Dubai' },
  { id: 'doha', name: 'Doha', country: 'Qatar', tz: 'Asia/Qatar' },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', tz: 'Africa/Cairo' },
  { id: 'istanbul', name: 'Istanbul', country: 'Turkey', tz: 'Europe/Istanbul' },
  { id: 'london', name: 'London', country: 'UK', tz: 'Europe/London' },
  { id: 'paris', name: 'Paris', country: 'France', tz: 'Europe/Paris' },
  { id: 'berlin', name: 'Berlin', country: 'Germany', tz: 'Europe/Berlin' },
  { id: 'newyork', name: 'New York', country: 'USA', tz: 'America/New_York' },
  { id: 'losangeles', name: 'Los Angeles', country: 'USA', tz: 'America/Los_Angeles' },
  { id: 'toronto', name: 'Toronto', country: 'Canada', tz: 'America/Toronto' },
  { id: 'islamabad', name: 'Islamabad', country: 'Pakistan', tz: 'Asia/Karachi' },
  { id: 'dhaka', name: 'Dhaka', country: 'Bangladesh', tz: 'Asia/Dhaka' },
  { id: 'jakarta', name: 'Jakarta', country: 'Indonesia', tz: 'Asia/Jakarta' },
  { id: 'kualalumpur', name: 'Kuala Lumpur', country: 'Malaysia', tz: 'Asia/Kuala_Lumpur' },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', tz: 'Africa/Lagos' },
  { id: 'casablanca', name: 'Casablanca', country: 'Morocco', tz: 'Africa/Casablanca' },
  { id: 'beirut', name: 'Beirut', country: 'Lebanon', tz: 'Asia/Beirut' },
  { id: 'amman', name: 'Amman', country: 'Jordan', tz: 'Asia/Amman' },
  { id: 'tehran', name: 'Tehran', country: 'Iran', tz: 'Asia/Tehran' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', tz: 'Australia/Sydney' },
];

const CALC_METHODS = [
  { id: 'MWL', name: 'Muslim World League', aladhan: 3 },
  { id: 'ISNA', name: 'ISNA', aladhan: 2 },
  { id: 'Egypt', name: 'Egyptian Authority', aladhan: 5 },
  { id: 'Makkah', name: 'Umm al-Qura', aladhan: 4 },
  { id: 'Karachi', name: 'Karachi', aladhan: 1 },
];

const MADHAB_OPTIONS = [
  { id: 'shafi', name: 'Shafi / Maliki / Hanbali', school: 0 },
  { id: 'hanafi', name: 'Hanafi', school: 1 },
];

/** Mock prayer times — replace with real API integration */
function generateMockTimes(cityId) {
  const baseMins = [312, 394, 738, 930, 1108, 1198];
  let hash = 0;
  for (let i = 0; i < cityId.length; i++) hash = ((hash << 5) - hash + cityId.charCodeAt(i)) | 0;
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return baseMins.map((m, i) => {
    const offset = ((Math.abs(hash) >> (i * 3)) % 21) - 10;
    return new Date(dayStart.getTime() + (m + offset) * 60000);
  });
}

const PRAYER_DEFS = [
  { key: 'fajr', name: 'Fajr', arabic: '\u0627\u0644\u0641\u062C\u0631', idx: 0, isPrayer: true },
  { key: 'sunrise', name: 'Sunrise', arabic: '\u0627\u0644\u0634\u0631\u0648\u0642', idx: 1, isPrayer: false },
  { key: 'dhuhr', name: 'Dhuhr', arabic: '\u0627\u0644\u0638\u0647\u0631', idx: 2, isPrayer: true },
  { key: 'asr', name: 'Asr', arabic: '\u0627\u0644\u0639\u0635\u0631', idx: 3, isPrayer: true },
  { key: 'maghrib', name: 'Maghrib', arabic: '\u0627\u0644\u0645\u063A\u0631\u0628', idx: 4, isPrayer: true },
  { key: 'isha', name: 'Isha', arabic: '\u0627\u0644\u0639\u0634\u0627\u0621', idx: 5, isPrayer: true },
];

function formatPrayerTime(date, options = {}) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: options.hour12 ?? true,
  });
}

function formatDurationShort(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function getHijriInfo(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(date);
    const monthNumber = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '1447', 10);
    const monthArabic = [
      'Muharram / \u0627\u0644\u0645\u062D\u0631\u0645',
      'Safar / \u0635\u0641\u0631',
      'Rabi\u02BB I / \u0631\u0628\u064A\u0639 \u0627\u0644\u0623\u0648\u0644',
      'Rabi\u02BB II / \u0631\u0628\u064A\u0639 \u0627\u0644\u0622\u062E\u0631',
      'Jumada I / \u062C\u0645\u0627\u062F\u0649 \u0627\u0644\u0623\u0648\u0644\u0649',
      'Jumada II / \u062C\u0645\u0627\u062F\u0649 \u0627\u0644\u0622\u062E\u0631\u0629',
      'Rajab / \u0631\u062C\u0628',
      'Sha\u02BBban / \u0634\u0639\u0628\u0627\u0646',
      'Ramadan / \u0631\u0645\u0636\u0627\u0646',
      'Shawwal / \u0634\u0648\u0627\u0644',
      'Dhu al-Qi\u02BBdah / \u0630\u0648 \u0627\u0644\u0642\u0639\u062F\u0629',
      'Dhu al-Hijjah / \u0630\u0648 \u0627\u0644\u062D\u062C\u0629',
    ][monthNumber - 1];
    return { day, monthNumber, year, monthArabic };
  } catch {
    return null;
  }
}

function getMoonPhaseInfo(date) {
  const lunarCycleMs = 29.530588853 * 24 * 60 * 60 * 1000;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const phase = (((date.getTime() - knownNewMoon) % lunarCycleMs) + lunarCycleMs) % lunarCycleMs / lunarCycleMs;
  const illumination = Math.round(((1 - Math.cos(phase * Math.PI * 2)) / 2) * 100);
  const phases = [
    { max: 0.03, name: 'New Moon', emoji: '●' },
    { max: 0.22, name: 'Waxing Crescent', emoji: '☽' },
    { max: 0.28, name: 'First Quarter', emoji: '◐' },
    { max: 0.47, name: 'Waxing Gibbous', emoji: '◕' },
    { max: 0.53, name: 'Full Moon', emoji: '○' },
    { max: 0.72, name: 'Waning Gibbous', emoji: '◕' },
    { max: 0.78, name: 'Last Quarter', emoji: '◑' },
    { max: 0.97, name: 'Waning Crescent', emoji: '☾' },
    { max: 1.01, name: 'New Moon', emoji: '●' },
  ];
  const hit = phases.find(p => phase <= p.max) || phases[0];
  return {
    phase,
    illumination,
    name: hit.name,
    emoji: hit.emoji,
    ageDays: (phase * 29.530588853).toFixed(1),
  };
}

// ─── Script style class map ───────────────────────────────

const SCRIPT_CLASS_MAP = {
  uthmani: 'script-uthmani',
  indopak: 'script-indopak',
  simple: 'script-simple',
  naskh: 'script-naskh',
};

// ─── Daily Rotating Content ───────────────────────────────

const getDayIndex = (pool) => {
  const d = new Date();
  // Use local midnight so content rotates at user's midnight, not UTC
  const localDaysSinceEpoch = Math.floor((Date.now() - d.getTimezoneOffset() * 60000) / 86400000);
  return localDaysSinceEpoch % pool.length;
};

const DAILY_VERSES = [
  { arabic: '\u0625\u0650\u0646\u0651\u064E \u0645\u064E\u0639\u064E \u0671\u0644\u0652\u0639\u064F\u0633\u0652\u0631\u0650 \u064A\u064F\u0633\u0652\u0631\u064B\u0627\u06ED', translation: 'Indeed, with hardship comes ease.', ref: 'Surah Ash-Sharh 94:6' },
  { arabic: '\u0641\u064E\u0627\u0630\u0652\u0643\u064F\u0631\u064F\u0648\u0646\u0650\u064A \u0623\u064E\u0630\u0652\u0643\u064F\u0631\u0652\u0643\u064F\u0645\u0652', translation: 'So remember Me; I will remember you.', ref: 'Surah Al-Baqarah 2:152' },
  { arabic: '\u0648\u064E\u0645\u064E\u0646 \u064A\u064E\u062A\u064E\u0648\u064E\u0643\u0651\u064E\u0644\u0652 \u0639\u064E\u0644\u064E\u0649 \u0627\u0644\u0644\u0651\u0647\u0650 \u0641\u064E\u0647\u064F\u0648\u064E \u062D\u064E\u0633\u0652\u0628\u064F\u0647\u064F', translation: 'And whoever relies upon Allah, then He is sufficient for him.', ref: 'Surah At-Talaq 65:3' },
  { arabic: '\u0623\u064E\u0644\u0627 \u0628\u0650\u0630\u0650\u0643\u0652\u0631\u0650 \u0627\u0644\u0644\u0651\u0647\u0650 \u062A\u064E\u0637\u0652\u0645\u064E\u0626\u0650\u0646\u0651\u064F \u0627\u0644\u0652\u0642\u064F\u0644\u0648\u0628\u064F', translation: 'Verily, in the remembrance of Allah do hearts find rest.', ref: 'Surah Ar-Ra\'d 13:28' },
  { arabic: '\u0644\u064E\u0626\u0650\u0646 \u0634\u064E\u0643\u064E\u0631\u062A\u064F\u0645\u0652 \u0644\u064E\u0623\u064E\u0632\u064A\u062F\u064E\u0646\u0651\u064E\u0643\u064F\u0645\u0652', translation: 'If you are grateful, I will surely increase you [in favor].', ref: 'Surah Ibrahim 14:7' },
  { arabic: '\u0648\u064E\u0644\u064E\u0633\u064E\u0648\u0652\u0641\u064E \u064A\u064F\u0639\u0652\u0637\u064A\u0643\u064E \u0631\u064E\u0628\u0651\u064F\u0643\u064E \u0641\u064E\u062A\u064E\u0631\u0652\u0636\u0649', translation: 'And your Lord is going to give you, and you will be satisfied.', ref: 'Surah Ad-Dhuha 93:5' },
  { arabic: '\u0648\u064E\u0631\u064E\u062D\u0652\u0645\u064E\u062A\u064A \u0648\u064E\u0633\u0650\u0639\u064E\u062A\u0652 \u0643\u064F\u0644\u0651\u064E \u0634\u064E\u064A\u0652\u0621\u064D', translation: 'My mercy encompasses all things.', ref: 'Surah Al-A\'raf 7:156' },
];

const DAILY_HADITHS = [
  { text: 'The best among you are those who learn the Quran and teach it.', source: 'Sahih al-Bukhari' },
  { text: 'None of you truly believes until he loves for his brother what he loves for himself.', source: 'Sahih al-Bukhari & Muslim' },
  { text: 'The strong person is not the one who can wrestle someone else down. The strong person is the one who can control himself when he is angry.', source: 'Sahih al-Bukhari' },
  { text: 'Make things easy and do not make them difficult. Give good tidings and do not make people run away.', source: 'Sahih al-Bukhari' },
  { text: 'Whoever believes in Allah and the Last Day, let him speak good or remain silent.', source: 'Sahih al-Bukhari & Muslim' },
  { text: 'Smiling in the face of your brother is charity.', source: 'Jami at-Tirmidhi' },
  { text: 'The most beloved of deeds to Allah are those that are most consistent, even if they are small.', source: 'Sahih al-Bukhari & Muslim' },
];

const DAILY_REFLECTIONS = [
  { title: 'The virtue of patience', desc: 'Take a moment to reflect today' },
  { title: 'Gratitude in hardship', desc: 'Finding blessings in every test' },
  { title: 'Kindness to others', desc: 'The way of the Prophet \u2E28\uFDFA\u2E29' },
  { title: 'Sincerity of intention', desc: 'Purifying your niyyah' },
  { title: 'The power of dua', desc: 'Allah is always listening' },
  { title: 'Trust in Allah\'s plan', desc: 'He knows what you do not' },
  { title: 'The beauty of forgiveness', desc: 'Let go and let Allah handle it' },
];

// ─── Settings Panel ────────────────────────────────────────

function SettingsPanel() {
  const { settings, updateSetting, resetSection, setShowSettings } = useSettings();
  const [availableTranslations, setAvailableTranslations] = useState([]);
  const [customHexInput, setCustomHexInput] = useState(settings.customAccent || '');

  useEffect(() => {
    setCustomHexInput(settings.customAccent || '');
  }, [settings.customAccent]);

  const applyCustomAccent = (value) => {
    const normalized = normalizeHexColor(value);
    if (!normalized) return false;
    updateSetting('customAccent', normalized);
    return true;
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/translations`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.translations) setAvailableTranslations(data.translations); })
      .catch(() => {});
  }, []);

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={() => setShowSettings(false)}>&#215;</button>
        </div>
        <div className="settings-content">
          {/* Typography */}
          <div className="settings-section">
            <h4 className="settings-section-title">Typography</h4>

            <div className="settings-control">
              <label>Global Text Scale: {settings.globalTextScale.toFixed(1)}x</label>
              <input type="range" min="0.8" max="2.0" step="0.1" value={settings.globalTextScale}
                onChange={e => updateSetting('globalTextScale', parseFloat(e.target.value))} className="settings-slider" />
            </div>

            <div className="settings-control">
              <label>Arabic Size: {settings.arabicSize.toFixed(1)}rem</label>
              <input type="range" min="1.2" max="10" step="0.1" value={settings.arabicSize}
                onChange={e => updateSetting('arabicSize', parseFloat(e.target.value))} className="settings-slider" />
            </div>

            <div className="settings-control">
              <label>Arabic Line Height: {settings.arabicLineHeight.toFixed(1)}</label>
              <input type="range" min="1.5" max="10" step="0.1" value={settings.arabicLineHeight}
                onChange={e => updateSetting('arabicLineHeight', parseFloat(e.target.value))} className="settings-slider" />
            </div>

            <div className="settings-control">
              <label>Translation Size: {settings.translationSize.toFixed(1)}rem</label>
              <input type="range" min="0.7" max="10" step="0.1" value={settings.translationSize}
                onChange={e => updateSetting('translationSize', parseFloat(e.target.value))} className="settings-slider" />
            </div>

            <div className="settings-control">
              <label>Translation Line Height: {settings.translationLineHeight.toFixed(1)}</label>
              <input type="range" min="1.2" max="10" step="0.1" value={settings.translationLineHeight}
                onChange={e => updateSetting('translationLineHeight', parseFloat(e.target.value))} className="settings-slider" />
            </div>

            <div className="settings-control">
              <label>Script Style</label>
              <div className="button-group">
                {[
                  { value: 'uthmani', label: 'Uthmani' },
                  { value: 'indopak', label: 'Indo-Pak' },
                  { value: 'simple', label: 'Simple' },
                  { value: 'naskh', label: 'Naskh' },
                ].map(s => (
                  <button key={s.value}
                    className={`btn-option ${settings.scriptStyle === s.value ? 'active' : ''}`}
                    onClick={() => updateSetting('scriptStyle', s.value)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <button className="section-reset-btn" onClick={() => resetSection(['arabicSize','arabicLineHeight','translationSize','translationLineHeight','globalTextScale','scriptStyle'])}>↺ Reset Typography</button>
          </div>

          {/* Quran Reader */}
          <div className="settings-section">
            <h4 className="settings-section-title">Quran Reader</h4>

            <div className="settings-control toggle">
              <label>Show Translation</label>
              <button className={`toggle-btn ${settings.showTranslation ? 'on' : 'off'}`}
                onClick={() => updateSetting('showTranslation', !settings.showTranslation)}>
                {settings.showTranslation ? 'ON' : 'OFF'}
              </button>
            </div>

            {settings.showTranslation && availableTranslations.length > 0 && (
              <div className="settings-control">
                <label>Translation</label>
                <select value={settings.translationId}
                  onChange={e => updateSetting('translationId', parseInt(e.target.value))} className="settings-select">
                  {availableTranslations.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="settings-control toggle">
              <label>Ayah Numbers</label>
              <button className={`toggle-btn ${settings.showAyahBadges ? 'on' : 'off'}`}
                onClick={() => updateSetting('showAyahBadges', !settings.showAyahBadges)}>
                {settings.showAyahBadges ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="settings-control toggle">
              <label>Word-by-Word</label>
              <button className={`toggle-btn ${settings.wordByWord ? 'on' : 'off'}`}
                onClick={() => updateSetting('wordByWord', !settings.wordByWord)}>
                {settings.wordByWord ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="settings-control toggle">
              <label>Tajweed Colors</label>
              <button className={`toggle-btn ${settings.tajweedMode ? 'on' : 'off'}`}
                onClick={() => updateSetting('tajweedMode', !settings.tajweedMode)}>
                {settings.tajweedMode ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="settings-control">
              <label>View Mode</label>
              <div className="button-group">
                <button className={`btn-option ${settings.viewMode === 'card' ? 'active' : ''}`}
                  onClick={() => updateSetting('viewMode', 'card')}>Card</button>
                <button className={`btn-option ${settings.viewMode === 'flat' ? 'active' : ''}`}
                  onClick={() => updateSetting('viewMode', 'flat')}>Flat</button>
              </div>
            </div>
            <button className="section-reset-btn" onClick={() => resetSection(['showTranslation','showAyahBadges','wordByWord','tajweedMode','viewMode','translationId'])}>↺ Reset Reader</button>
          </div>

          {/* Custom Theme */}
          <div className="settings-section custom-theme-section">
            <h4 className="settings-section-title">Custom Theme</h4>
            <p className="settings-section-subtitle">Text contrast is auto-adjusted for readability</p>

            <div className="custom-color-grid">
              {CUSTOM_THEME_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`custom-color-swatch ${settings.customAccent === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => {
                    setCustomHexInput(color);
                    updateSetting('customAccent', color);
                  }}
                  title={`Use ${color}`}
                  aria-label={`Use custom theme color ${color}`}
                />
              ))}
            </div>

            <div className="settings-control">
              <label htmlFor="custom-theme-color">Pick Custom Theme Color</label>
              <input
                id="custom-theme-color"
                type="color"
                value={normalizeHexColor(settings.customAccent) || '#2F8FFF'}
                onChange={(e) => {
                  const value = normalizeHexColor(e.target.value);
                  setCustomHexInput(value);
                  updateSetting('customAccent', value);
                }}
                className="settings-select"
                style={{ padding: '4px', height: '42px' }}
              />
            </div>

            <div className="custom-hex-row">
              <span className="hex-label">HEX</span>
              <input
                className="hex-input"
                placeholder="#2F8FFF"
                value={customHexInput}
                onChange={(e) => setCustomHexInput(e.target.value.toUpperCase())}
                onBlur={() => {
                  if (!applyCustomAccent(customHexInput)) {
                    setCustomHexInput(settings.customAccent || '');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (!applyCustomAccent(customHexInput)) {
                      setCustomHexInput(settings.customAccent || '');
                    }
                  }
                }}
                aria-label="Custom theme hex value"
              />
              <div
                className="custom-preview"
                style={{ background: normalizeHexColor(customHexInput) || normalizeHexColor(settings.customAccent) || '#2F8FFF' }}
                aria-hidden="true"
              />
              <button
                type="button"
                className="accent-reset-btn"
                onClick={() => {
                  setCustomHexInput('');
                  updateSetting('customAccent', '');
                }}
              >
                Reset
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Home Component ────────────────────────────────────────

function Home({ onNavigate }) {
  const { settings } = useSettings();
  const scriptClass = SCRIPT_CLASS_MAP[settings.scriptStyle] || SCRIPT_CLASS_MAP.uthmani;
  const [greeting, setGreeting] = useState('');
  const [hijriDate, setHijriDate] = useState('');
  const [gregorianDate, setGregorianDate] = useState('');
  const [lastRead, setLastRead] = useState(null);
  const [recentSurahs, setRecentSurahs] = useState([]);
  const [nextPrayerPreview, setNextPrayerPreview] = useState(null);
  const [dailyGoal, setDailyGoal] = useState({
    read: 0,
    target: 1,
    levelIndex: 0,
    masteryStreak: 0,
    promotionNeed: DAILY_GOAL_PROMOTION_STREAK,
    nextTarget: DAILY_GOAL_LEVELS[1] || 1,
    atMaxLevel: false,
  });

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 17) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');

    const now = new Date();
    try {
      setHijriDate(new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        year: 'numeric', month: 'long', day: 'numeric'
      }).format(now));
    } catch { setHijriDate(''); }

    setGregorianDate(now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    }));

    try {
      const saved = localStorage.getItem('lastReadSurah');
      if (saved) setLastRead(JSON.parse(saved));
    } catch {}

    setRecentSurahs(loadRecentSurahs());

    // Daily goal with adaptive progression
    try {
      const { state, profile } = ensureDailyGoalState();
      const atMaxLevel = profile.levelIndex >= DAILY_GOAL_LEVELS.length - 1;
      setDailyGoal({
        read: state.read || 0,
        target: state.target || getDailyGoalTarget(profile.levelIndex),
        levelIndex: profile.levelIndex,
        masteryStreak: profile.masteryStreak || 0,
        promotionNeed: DAILY_GOAL_PROMOTION_STREAK,
        nextTarget: atMaxLevel ? getDailyGoalTarget(profile.levelIndex) : getDailyGoalTarget(profile.levelIndex + 1),
        atMaxLevel,
      });
    } catch {}

    // Next prayer preview — fetch real times from Aladhan API
    try {
      let loc = { name: 'Mecca', country: 'Saudi Arabia' };
      try { const sl = localStorage.getItem('salahLocation'); if (sl) loc = JSON.parse(sl); } catch {}
      fetch(`${API_BASE}/api/prayer-times?city=${encodeURIComponent(loc.name)}&country=${encodeURIComponent(loc.country)}&method=3`)
        .then(r => r.json())
        .then(data => {
          if (data?.data?.timings) {
            const t = data.data.timings;
            const parseT = (s) => { const [h, m] = s.split(':').map(Number); const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m); };
            const prs = [{ name: 'Fajr', time: parseT(t.Fajr) }, { name: 'Dhuhr', time: parseT(t.Dhuhr) }, { name: 'Asr', time: parseT(t.Asr) }, { name: 'Maghrib', time: parseT(t.Maghrib) }, { name: 'Isha', time: parseT(t.Isha) }];
            const np = prs.find(p => p.time > now);
            if (np) setNextPrayerPreview({ name: np.name, timeStr: formatPrayerTime(np.time) });
          }
        })
        .catch(() => {});
    } catch {}
  }, []);

  const scale = settings.globalTextScale || 1;
  const todayVerse = DAILY_VERSES[getDayIndex(DAILY_VERSES)];
  const todayHadith = DAILY_HADITHS[getDayIndex(DAILY_HADITHS)];
  const todayReflection = DAILY_REFLECTIONS[getDayIndex(DAILY_REFLECTIONS)];

  // Reading timer
  const [, forceReadingTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      forceReadingTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const todaySeconds = getTodaySeconds();
  const todayMinutesPart = Math.floor(todaySeconds / 60);
  const todaySecondsPart = todaySeconds % 60;
  const todayTimeDisplay = `${todayMinutesPart}:${String(todaySecondsPart).padStart(2, '0')}`;
  const streak = getReadingStreak();

  // Random ayah
  const [randomAyah, setRandomAyah] = useState(null);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const fetchRandomAyah = async () => {
    setLoadingRandom(true);
    try {
      const chNum = Math.floor(Math.random() * 114) + 1;
      const res = await fetch(`${API_BASE}/api/chapters/${chNum}/verses/${settings.translationId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.verses?.length) {
        const v = data.verses[Math.floor(Math.random() * data.verses.length)];
        setRandomAyah({
          arabic: v.text_uthmani,
          translation: v.translation_text || '',
          ref: `Surah ${chNum}:${v.verse_number_in_surah || v.verse_number}`,
          surahNum: chNum,
        });
      }
    } catch {
      setRandomAyah(null);
    } finally {
      setLoadingRandom(false);
    }
  };

  return (
    <div className="home-page" style={{ fontSize: `${scale}rem` }}>
      <div className="home-geo-pattern" />

      {/* Hero */}
      <div className="home-hero home-grid-hero">
        <div className="home-header-stack">
          <div className="home-bismillah">{'\uFDFD'}</div>
          <h1 className="home-title" style={{ fontSize: `${2.15 * scale}rem` }}>As-Salamu Alaykum</h1>
          <p className="home-greeting">{greeting}</p>
          <div className="home-date-row">
            {hijriDate && <p className="home-hijri">{hijriDate}</p>}
            {hijriDate && gregorianDate && <span className="home-date-dot" />}
            {gregorianDate && <p className="home-gregorian">{gregorianDate}</p>}
          </div>
        </div>
      </div>

      {/* Verse of the Day - Full Width Hero Card */}
      <div className="home-verse-card home-grid-verse" onClick={() => onNavigate?.('quran')}>
        <div className="home-verse-label">Verse of the Day</div>
        <p className={`home-verse-arabic ${scriptClass}`}>
          {todayVerse.arabic}
        </p>
        <p className="home-verse-translation">
          &ldquo;{todayVerse.translation}&rdquo;
        </p>
        <div className="home-verse-footer">
          <p className="home-verse-ref">{todayVerse.ref}</p>
          <button className="home-verse-action" onClick={e => { e.stopPropagation(); onNavigate?.('quran'); }}>
            Open in Quran
          </button>
        </div>
      </div>

      {/* Quick Stats Sidebar */}
      <div className="home-section-card home-quick-stats">
        <div className="home-stats-title">Today's Progress</div>
        <div className="home-stats-item">
          <span className="home-stats-label">Reading Time</span>
          <span className="home-stats-value">0 min</span>
        </div>
        <div className="home-stats-item">
          <span className="home-stats-label">Verses Read</span>
          <span className="home-stats-value">0</span>
        </div>
        <div className="home-stats-item">
          <span className="home-stats-label">Streak</span>
          <span className="home-stats-value">0 days</span>
        </div>
        <div className="home-stats-item">
          <span className="home-stats-label">Daily Goal</span>
          <div className="home-stats-progress">
            <div className="home-stats-bar" style={{width: '0%'}}></div>
          </div>
        </div>
      </div>

      {/* Continue Reading & Next Prayer - Side by Side */}
      {lastRead && (
        <div className="home-section-card home-continue-reading" onClick={() => onNavigate?.('quran')}>
          <div className="home-section-header">
            <span className="home-section-icon"><IconPlay /></span>
            <h4 className="home-section-title">Continue Reading</h4>
          </div>
          <div className="home-continue-info">
            <div className="home-continue-text">
              <h4>{lastRead.name || `Surah ${lastRead.number}`}</h4>
              <p>Ayah {lastRead.ayah || 1}</p>
            </div>
            <span className="home-continue-arrow"><IconChevron /></span>
          </div>
        </div>
      )}

      {nextPrayerPreview && (
        <div
          className={`home-section-card home-grid-section ${lastRead ? '' : 'home-grid-section--full'}`}
          onClick={() => onNavigate?.('salah')}
        >
          <div className="home-section-header">
            <span className="home-section-icon"><IconPrayer /></span>
            <h4 className="home-section-title">Next Prayer</h4>
          </div>
          <div className="home-continue-info">
            <div className="home-continue-text">
              <h4>{nextPrayerPreview.name}</h4>
              <p>{nextPrayerPreview.timeStr}</p>
            </div>
            <span className="home-continue-arrow"><IconChevron /></span>
          </div>
        </div>
      )}

      {/* Recent Surahs */}
      {recentSurahs.length > 0 && (
        <div className="home-section-card home-recent-surahs">
          <div className="home-section-header">
            <span className="home-section-icon"><IconBookmark /></span>
            <h4 className="home-section-title">Recent Surahs</h4>
          </div>
          <div className="home-recent-list">
            {recentSurahs.map(item => (
              <button
                key={item.id}
                className="home-recent-item"
                onClick={() => onNavigate?.('quran', item.id)}
              >
                <span className="home-recent-number">{item.id}</span>
                <span className="home-recent-name">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Access - 4 Column Grid */}
      <div className="home-quick-access">
        <button className="home-card" onClick={() => onNavigate?.('quran')}>
          <span className="home-card-icon"><IconBook /></span>
          <span className="home-card-label">Read Quran</span>
          <span className="home-card-desc">114 Surahs</span>
        </button>
        <button className="home-card" onClick={() => onNavigate?.('salah')}>
          <span className="home-card-icon"><IconClock /></span>
          <span className="home-card-label">Salah Times</span>
          <span className="home-card-desc">Prayer schedule</span>
        </button>
        <button className="home-card" onClick={() => onNavigate?.('quran')}>
          <span className="home-card-icon"><IconBookmark /></span>
          <span className="home-card-label">Bookmarks</span>
          <span className="home-card-desc">Your saved ayahs</span>
        </button>
        <button className="home-card" onClick={() => onNavigate?.('explore')}>
          <span className="home-card-icon"><IconCompass /></span>
          <span className="home-card-label">Explore</span>
          <span className="home-card-desc">Learn more</span>
        </button>
      </div>

      {/* Reading Stats - Full Width */}
      <div className="home-reading-stats home-grid-stats">
        <div className="home-stat">
          <span className="home-stat-icon"><IconTimer /></span>
          <span className="home-stat-value">{todayTimeDisplay}</span>
          <span className="home-stat-label">min:sec today</span>
        </div>
        <div className="home-stat-divider" />
        <div className="home-stat">
          <span className="home-stat-icon"><IconFire /></span>
          <span className="home-stat-value">{streak}</span>
          <span className="home-stat-label">day streak</span>
        </div>
      </div>

      {/* Daily Goal - Full Width */}
      <div className="home-section-card home-grid-goal">
        <div className="home-section-header">
          <span className="home-section-icon"><IconTarget /></span>
          <h4 className="home-section-title">Daily Goal - Level {dailyGoal.levelIndex + 1}</h4>
        </div>
        <div className="home-goal-row">
          <div className="home-goal-info">
            <h4>Read {dailyGoal.target} unique surah{dailyGoal.target > 1 ? 's' : ''} today</h4>
            <p>{dailyGoal.read >= dailyGoal.target ? 'Goal complete. Keep this up to unlock harder targets.' : 'Complete today\'s mission to build mastery.'}</p>
          </div>
          <div className="home-goal-badge">{dailyGoal.read} / {dailyGoal.target}</div>
        </div>
        <div className="home-goal-meta">
          <span>
            Mastery streak: {dailyGoal.masteryStreak}/{dailyGoal.promotionNeed}
          </span>
          <span>
            {dailyGoal.atMaxLevel ? 'Max level reached' : `Next level target: ${dailyGoal.nextTarget}/day`}
          </span>
        </div>
        <div className="home-progress-bar">
          <div className="home-progress-fill" style={{ width: `${Math.min(100, (dailyGoal.read / dailyGoal.target) * 100)}%` }} />
        </div>
      </div>

      {/* Random Ayah & Daily Reflection - Side by Side */}
      <div className="home-random-reflection-row">
        <div className="home-section-card">
          <div className="home-section-header">
            <span className="home-section-icon"><IconDice /></span>
            <h4 className="home-section-title">Random Ayah</h4>
            <button className="home-random-btn" onClick={fetchRandomAyah} disabled={loadingRandom}>
              {loadingRandom ? <span className="auth-spinner-sm" /> : 'Surprise me ✨'}
            </button>
          </div>
          {randomAyah && (
            <div className="home-random-ayah" onClick={() => onNavigate?.('quran', randomAyah.surahNum)}>
              <p className={`home-random-arabic ${scriptClass}`}>{randomAyah.arabic}</p>
              <p className="home-random-trans">&ldquo;{randomAyah.translation}&rdquo;</p>
              <p className="home-random-ref">{randomAyah.ref}</p>
            </div>
          )}
        </div>

        <div className="home-section-card" onClick={() => onNavigate?.('explore')}>
          <div className="home-section-header">
            <span className="home-section-icon"><IconStar /></span>
            <h4 className="home-section-title">Daily Reflection</h4>
          </div>
          <div className="home-continue-info">
            <div className="home-continue-text">
              <h4>{todayReflection.title}</h4>
              <p>{todayReflection.desc}</p>
            </div>
            <span className="home-continue-arrow"><IconChevron /></span>
          </div>
        </div>
      </div>

      {/* Hadith - Full Width */}
      <div className="home-hadith home-grid-verse">
        <div className="home-hadith-deco">&ldquo;</div>
        <p className="home-hadith-text">
          {todayHadith.text}
        </p>
        <p className="home-hadith-source">{todayHadith.source}</p>
      </div>

      <div className="home-spacer" />
    </div>
  );
}

// ─── Arabic Chapter Names ──────────────────────────────────

const ARABIC_NAMES = {
  1: '\u0627\u0644\u0641\u0627\u062A\u062D\u0629', 2: '\u0627\u0644\u0628\u0642\u0631\u0629',
  3: '\u0622\u0644 \u0639\u0645\u0631\u0627\u0646', 4: '\u0627\u0644\u0646\u0633\u0627\u0621',
  5: '\u0627\u0644\u0645\u0627\u0626\u062F\u0629', 6: '\u0627\u0644\u0623\u0646\u0639\u0627\u0645',
  7: '\u0627\u0644\u0623\u0639\u0631\u0627\u0641', 8: '\u0627\u0644\u0623\u0646\u0641\u0627\u0644',
  9: '\u0627\u0644\u062A\u0648\u0628\u0629', 10: '\u064A\u0648\u0646\u0633',
  11: '\u0647\u0648\u062F', 12: '\u064A\u0648\u0633\u0641',
  13: '\u0627\u0644\u0631\u0639\u062F', 14: '\u0625\u0628\u0631\u0627\u0647\u064A\u0645',
  15: '\u0627\u0644\u062D\u062C\u0631', 16: '\u0627\u0644\u0646\u062D\u0644',
  17: '\u0627\u0644\u0625\u0633\u0631\u0627\u0621', 18: '\u0627\u0644\u0643\u0647\u0641',
  19: '\u0645\u0631\u064A\u0645', 20: '\u0637\u0647',
  21: '\u0627\u0644\u0623\u0646\u0628\u064A\u0627\u0621', 22: '\u0627\u0644\u062D\u062C',
  23: '\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646', 24: '\u0627\u0644\u0646\u0648\u0631',
  25: '\u0627\u0644\u0641\u0631\u0642\u0627\u0646', 26: '\u0627\u0644\u0634\u0639\u0631\u0627\u0621',
  27: '\u0627\u0644\u0646\u0645\u0644', 28: '\u0627\u0644\u0642\u0635\u0635',
  29: '\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062A', 30: '\u0627\u0644\u0631\u0648\u0645',
  31: '\u0644\u0642\u0645\u0627\u0646', 32: '\u0627\u0644\u0633\u062C\u062F\u0629',
  33: '\u0627\u0644\u0623\u062D\u0632\u0627\u0628', 34: '\u0633\u0628\u0623',
  35: '\u0641\u0627\u0637\u0631', 36: '\u064A\u0633',
  37: '\u0627\u0644\u0635\u0627\u0641\u0627\u062A', 38: '\u0635',
  39: '\u0627\u0644\u0632\u0645\u0631', 40: '\u063A\u0627\u0641\u0631',
  41: '\u0641\u0635\u0644\u062A', 42: '\u0627\u0644\u0634\u0648\u0631\u0649',
  43: '\u0627\u0644\u0632\u062E\u0631\u0641', 44: '\u0627\u0644\u062F\u062E\u0627\u0646',
  45: '\u0627\u0644\u062C\u0627\u062B\u064A\u0629', 46: '\u0627\u0644\u0623\u062D\u0642\u0627\u0641',
  47: '\u0645\u062D\u0645\u062F', 48: '\u0627\u0644\u0641\u062A\u062D',
  49: '\u0627\u0644\u062D\u062C\u0631\u0627\u062A', 50: '\u0642',
  51: '\u0627\u0644\u0630\u0627\u0631\u064A\u0627\u062A', 52: '\u0627\u0644\u0637\u0648\u0631',
  53: '\u0627\u0644\u0646\u062C\u0645', 54: '\u0627\u0644\u0642\u0645\u0631',
  55: '\u0627\u0644\u0631\u062D\u0645\u0646', 56: '\u0627\u0644\u0648\u0627\u0642\u0639\u0629',
  57: '\u0627\u0644\u062D\u062F\u064A\u062F', 58: '\u0627\u0644\u0645\u062C\u0627\u062F\u0644\u0629',
  59: '\u0627\u0644\u062D\u0634\u0631', 60: '\u0627\u0644\u0645\u0645\u062A\u062D\u0646\u0629',
  61: '\u0627\u0644\u0635\u0641', 62: '\u0627\u0644\u062C\u0645\u0639\u0629',
  63: '\u0627\u0644\u0645\u0646\u0627\u0641\u0642\u0648\u0646', 64: '\u0627\u0644\u062A\u063A\u0627\u0628\u0646',
  65: '\u0627\u0644\u0637\u0644\u0627\u0642', 66: '\u0627\u0644\u062A\u062D\u0631\u064A\u0645',
  67: '\u0627\u0644\u0645\u0644\u0643', 68: '\u0627\u0644\u0642\u0644\u0645',
  69: '\u0627\u0644\u062D\u0627\u0642\u0629', 70: '\u0627\u0644\u0645\u0639\u0627\u0631\u062C',
  71: '\u0646\u0648\u062D', 72: '\u0627\u0644\u062C\u0646',
  73: '\u0627\u0644\u0645\u0632\u0645\u0644', 74: '\u0627\u0644\u0645\u062F\u062B\u0631',
  75: '\u0627\u0644\u0642\u064A\u0627\u0645\u0629', 76: '\u0627\u0644\u0625\u0646\u0633\u0627\u0646',
  77: '\u0627\u0644\u0645\u0631\u0633\u0644\u0627\u062A', 78: '\u0627\u0644\u0646\u0628\u0623',
  79: '\u0627\u0644\u0646\u0627\u0639\u064A\u0627\u062A', 80: '\u0639\u0628\u0633',
  81: '\u0627\u0644\u062A\u0643\u0648\u064A\u0631', 82: '\u0627\u0644\u0627\u0646\u0641\u0637\u0627\u0631',
  83: '\u0627\u0644\u0645\u0637\u0641\u0641\u064A\u0646', 84: '\u0627\u0644\u0627\u0646\u0634\u0642\u0627\u0642',
  85: '\u0627\u0644\u0628\u0631\u0648\u062C', 86: '\u0627\u0644\u0637\u0627\u0631\u0642',
  87: '\u0627\u0644\u0623\u0639\u0644\u0649', 88: '\u0627\u0644\u063A\u0627\u0634\u064A\u0629',
  89: '\u0627\u0644\u0641\u062C\u0631', 90: '\u0627\u0644\u0628\u0644\u062F',
  91: '\u0627\u0644\u0634\u0645\u0633', 92: '\u0627\u0644\u0644\u064A\u0644',
  93: '\u0627\u0644\u0636\u062D\u0649', 94: '\u0627\u0644\u0634\u0631\u062D',
  95: '\u0627\u0644\u062A\u064A\u0646', 96: '\u0627\u0644\u0639\u0644\u0642',
  97: '\u0627\u0644\u0642\u062F\u0631', 98: '\u0627\u0644\u0628\u064A\u0646\u0629',
  99: '\u0627\u0644\u0632\u0644\u0632\u0644\u0629', 100: '\u0627\u0644\u0639\u0627\u062F\u064A\u0627\u062A',
  101: '\u0627\u0644\u0642\u0627\u0631\u0639\u0629', 102: '\u0627\u0644\u062A\u0643\u0627\u062B\u0631',
  103: '\u0627\u0644\u0639\u0635\u0631', 104: '\u0627\u0644\u0647\u0645\u0632\u0629',
  105: '\u0627\u0644\u0641\u064A\u0644', 106: '\u0642\u0631\u064A\u0634',
  107: '\u0627\u0644\u0645\u0627\u0639\u0648\u0646', 108: '\u0627\u0644\u0643\u0648\u062B\u0631',
  109: '\u0627\u0644\u0643\u0627\u0641\u0631\u0648\u0646', 110: '\u0627\u0644\u0646\u0635\u0631',
  111: '\u0627\u0644\u0645\u0633\u062F', 112: '\u0627\u0644\u0625\u062E\u0644\u0627\u0635',
  113: '\u0627\u0644\u0641\u0644\u0642', 114: '\u0627\u0644\u0646\u0627\u0633',
};

const getArabicChapterName = (id) => ARABIC_NAMES[id] || '\u0633\u0648\u0631\u0629';

// Backend returns english_name / arabic_name (hardcoded + QF API shapes differ).
const normalizeChapterFromApi = (ch) => ({
  id: ch.id,
  chapter_number: ch.id ?? ch.chapter_number,
  name: ch.arabic_name || ch.name_arabic || getArabicChapterName(ch.id),
  name_simple: ch.english_name || ch.name_simple || ch.translated_name?.name || `Surah ${ch.id}`,
  translated: ch.translated_name?.name || ch.english_name || '',
});

// ─── Additional Quran Icons ────────────────────────────────

const IconMoreVert = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
  </svg>
);

const IconStop = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const IconNote = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const IconSkipBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="19 20 9 12 19 4 19 20" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </svg>
);

const IconSkipForward = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </svg>
);

const IconVolume = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const IconRepeat = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const IconArrowLeft = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);

const IconArrowRight = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

// ─── Available Reciters — Quran Foundation defaults ─

const QF_RECITERS = [
  { id: 1, name: 'Abdul Basit (Murattal)', style: 'Murattal', source: 'dc' },
  { id: 2, name: 'Abdul Basit (Mujawwad)', style: 'Mujawwad', source: 'dc' },
  { id: 3, name: 'Abdur-Rahman as-Sudais', style: 'Murattal', source: 'dc' },
  { id: 4, name: 'Abu Bakr al-Shatri', style: 'Murattal', source: 'dc' },
  { id: 5, name: 'Hani ar-Rifai', style: 'Murattal', source: 'dc' },
  { id: 6, name: 'Mahmoud Khaleel Al-Husary', style: 'Murattal', source: 'dc' },
  { id: 12, name: 'Al-Husary (Muallim)', style: 'Muallim', source: 'dc' },
  { id: 9, name: 'Muhammad Siddiq al-Minshawi', style: 'Murattal', source: 'dc' },
  { id: 168, name: 'Al-Minshawi (with kids)', style: 'Muallim', source: 'dc' },
  { id: 10, name: "Sa'ud ash-Shuraym", style: 'Murattal', source: 'dc' },
  { id: 13, name: 'Saad al-Ghamdi', style: 'Murattal', source: 'dc' },
  { id: 19, name: 'Ahmed ibn Ali al-Ajmy', style: 'Murattal', source: 'dc' },
  { id: 159, name: 'Maher al-Muaiqly', style: 'Murattal', source: 'dc' },
  { id: 160, name: 'Bandar Baleela', style: 'Murattal', source: 'dc' },
  { id: 158, name: 'Abdullah Ali Jabir', style: 'Murattal', source: 'dc' },
  { id: 161, name: 'Khalifah Al Tunaiji', style: 'Murattal', source: 'dc' },
  { id: 174, name: 'Yasser ad-Dussary', style: 'Murattal', source: 'dc' },
  { id: 175, name: 'Abdullah Hamad Abu Sharida', style: 'Murattal', source: 'dc' },
];

const inferReciterStyle = (name = '') => {
  const n = String(name).toLowerCase();
  if (n.includes('mujawwad')) return 'Mujawwad';
  if (n.includes('muallim') || n.includes('kids') || n.includes('child')) return 'Muallim';
  return 'Murattal';
};

// ─── Custom Reciter Picker (themed dropdown) ──────────────

function ReciterPicker({ reciters, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);
  const current = reciters.find(r => r.id === selected) || reciters[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  const handleOpen = () => {
    setSearch('');
    setOpen(!open);
  };

  const query = search.toLowerCase().trim();
  const filteredReciters = query ? reciters.filter(r => r.name.toLowerCase().includes(query)) : reciters;

  return (
    <div className="reciter-picker" ref={ref}>
      <button className="reciter-picker-btn" onClick={handleOpen}>
        <span className="reciter-picker-name">{current.name}</span>
        <span className={`reciter-picker-arrow ${open ? 'open' : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className="reciter-picker-dropdown">
          <div className="reciter-picker-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search reciters…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="reciter-picker-search-input"
            />
          </div>
          {filteredReciters.length > 0 && (
            <>
              <div className="reciter-picker-section">Reciters ({reciters.length})</div>
              {filteredReciters.map(r => (
                <button
                  key={r.id}
                  className={`reciter-picker-option ${r.id === selected ? 'active' : ''}`}
                  onClick={() => { onChange(r.id); setOpen(false); }}
                >
                  <span className="reciter-picker-option-name">{r.name}</span>
                  <span className="reciter-picker-option-style">{r.style}</span>
                </button>
              ))}
            </>
          )}
          {filteredReciters.length === 0 && (
            <div className="reciter-picker-empty">No reciters found</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ayah Dropdown Menu ───────────────────────────────────

function AyahDropdownMenu({ ayah, surahNumber, surahName, anchorRef, onClose, onPlayAyah, ayahPlaying }) {
  const [bookmarked, setBookmarked] = useState(false);
  const [showTafsir, setShowTafsir] = useState(false);
  const [tafsirText, setTafsirText] = useState('');
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState('');
  const [tafsirSource, setTafsirSource] = useState(169);
  const [tafsirCache, setTafsirCache] = useState({});
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  const verseKey = `${surahNumber}:${ayah.numberInSurah}`;

  // Calculate dropdown position relative to anchor button
  useEffect(() => {
    const updatePosition = () => {
      if (anchorRef?.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        setPosition({
          top: (rect.bottom + 8),
          left: (rect.right - 220)
        });
      }
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef]);

  // Load bookmark state
  useEffect(() => {
    try {
      const bm = JSON.parse(localStorage.getItem('ayahBookmarks') || '{}');
      setBookmarked(!!bm[verseKey]);
    } catch {}
  }, [verseKey]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          anchorRef?.current && !anchorRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleBookmark = () => {
    try {
      const bm = JSON.parse(localStorage.getItem('ayahBookmarks') || '{}');
      if (bm[verseKey]) { delete bm[verseKey]; setBookmarked(false); }
      else { bm[verseKey] = { surah: surahName, ayah: ayah.numberInSurah, ts: Date.now() }; setBookmarked(true); }
      localStorage.setItem('ayahBookmarks', JSON.stringify(bm));
    } catch {}
  };

  const loadTafsir = (srcId) => {
    setTafsirLoading(true);
    setTafsirError('');
    setTafsirText('');
    setTafsirSource(srcId);
    const cacheKey = `${srcId}_${surahNumber}`;
    if (tafsirCache[cacheKey]) {
      const entry = tafsirCache[cacheKey].find(t => t.verse_key === verseKey || t.verse_number === ayah.numberInSurah);
      setTafsirText(entry?.text || 'Tafsir not available for this ayah.');
      setTafsirLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/tafsir/${srcId}/by_chapter/${surahNumber}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => {
        const entries = data?.tafsirs || [];
        setTafsirCache(prev => ({ ...prev, [cacheKey]: entries }));
        const entry = entries.find(t => t.verse_key === verseKey || t.verse_number === ayah.numberInSurah);
        setTafsirText(entry?.text || 'Tafsir not available for this ayah.');
      })
      .catch(() => setTafsirError('Could not load tafsir. Server may be offline.'))
      .finally(() => setTafsirLoading(false));
  };

  const handleTafsir = () => {
    if (showTafsir) { setShowTafsir(false); return; }
    setShowTafsir(true);
    loadTafsir(tafsirSource);
  };

  const handleCopy = () => {
    const text = `${ayah.text}\n\n${ayah.translation}\n\n— Quran ${verseKey}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  const handleShare = () => {
    const text = `${ayah.text}\n\n${ayah.translation}\n\n— Quran ${verseKey}`;
    if (navigator.share) {
      navigator.share({ title: `Quran ${verseKey}`, text }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  return createPortal(
    <div 
      className="ayah-dropdown" 
      ref={menuRef} 
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 9999
      }}
    >
      <div className="ayah-dropdown-header">
        <span className="ayah-dropdown-verse">Ayah {ayah.numberInSurah}</span>
        <button className="ayah-dropdown-close" onClick={onClose}><IconX /></button>
      </div>
      <div className="ayah-dropdown-items">
        <button className={`ayah-dropdown-item ${bookmarked ? 'active' : ''}`} onClick={toggleBookmark}>
          <IconBookmarkFill filled={bookmarked} />
          <span>{bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
        </button>
        <button className={`ayah-dropdown-item ${ayahPlaying ? 'active' : ''}`} onClick={() => onPlayAyah(ayah.verseKey || `${surahNumber}:${ayah.numberInSurah}`)}>
          {ayahPlaying ? <IconPause /> : <IconPlaySmall />}
          <span>{ayahPlaying ? 'Pause Ayah' : 'Play Ayah'}</span>
        </button>
        <button className={`ayah-dropdown-item ${showTafsir ? 'active' : ''}`} onClick={handleTafsir}>
          <IconTafsir />
          <span>Tafsir</span>
        </button>
        <button className={`ayah-dropdown-item ${copied ? 'active' : ''}`} onClick={handleCopy}>
          {copied ? <IconCheck /> : <IconCopy />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
        <button className="ayah-dropdown-item" onClick={handleShare}>
          <IconShare />
          <span>Share</span>
        </button>
        <button className="ayah-dropdown-item" disabled>
          <IconNote />
          <span>Reflect</span>
        </button>
      </div>

      {showTafsir && (
        <div className="ayah-tafsir-section">
          <div className="ayah-tafsir-header">
            <span className="ayah-tafsir-title">Tafsir</span>
            <div className="ayah-tafsir-sources">
              <button className={`ayah-tafsir-src ${tafsirSource === 169 ? 'active' : ''}`} onClick={() => loadTafsir(169)}>Ibn Kathir</button>
              <button className={`ayah-tafsir-src ${tafsirSource === 171 ? 'active' : ''}`} onClick={() => loadTafsir(171)}>Jalalayn</button>
            </div>
          </div>
          <div className="ayah-tafsir-body">
            {tafsirLoading && <p className="ayah-tafsir-loading">Loading tafsir&hellip;</p>}
            {tafsirError && <p className="ayah-tafsir-error">{tafsirError}</p>}
            {!tafsirLoading && !tafsirError && tafsirText && (
              <div className="ayah-tafsir-text" dangerouslySetInnerHTML={{ __html: tafsirText }} />
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── Bookmarks Panel ───────────────────────────────────────

function BookmarksPanel({ onNavigate }) {
  const [bookmarks, setBookmarks] = useState([]);

  useEffect(() => {
    try {
      const bm = JSON.parse(localStorage.getItem('ayahBookmarks') || '{}');
      const list = Object.entries(bm).map(([key, val]) => ({
        verseKey: key,
        surah: val.surah,
        ayah: val.ayah,
        surahNumber: parseInt(key.split(':')[0]),
        ts: val.ts,
      })).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setBookmarks(list);
    } catch {}
  }, []);

  const removeBookmark = (verseKey) => {
    try {
      const bm = JSON.parse(localStorage.getItem('ayahBookmarks') || '{}');
      delete bm[verseKey];
      localStorage.setItem('ayahBookmarks', JSON.stringify(bm));
      setBookmarks(prev => prev.filter(b => b.verseKey !== verseKey));
    } catch {}
  };

  if (bookmarks.length === 0) {
    return (
      <div className="bookmarks-empty">
        <IconBookmarkFill filled={false} />
        <p>No bookmarks yet</p>
        <span>Tap the bookmark icon on any ayah to save it here</span>
      </div>
    );
  }

  return (
    <div className="bookmarks-list">
      {bookmarks.map(bm => (
        <div key={bm.verseKey} className="bookmark-item">
          <button className="bookmark-item-main" onClick={() => onNavigate(bm.surahNumber)}>
            <span className="bookmark-item-ref">{bm.verseKey}</span>
            <span className="bookmark-item-name">{bm.surah || `Surah ${bm.surahNumber}`}</span>
          </button>
          <button className="bookmark-item-remove" onClick={() => removeBookmark(bm.verseKey)} title="Remove">
            <IconX />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Quran Component ───────────────────────────────────────

function Quran({ audioControls, onOpenSearch }) {
  const { settings } = useSettings();
  const [surahs, setSurahs] = useState([]);
  const [juzs, setJuzs] = useState([]);
  const [hizbs, setHizbs] = useState([]);
  const [viewBy, setViewBy] = useState('surah');
  const [selectedSurah, setSelectedSurah] = useState(() => {
    try {
      const saved = localStorage.getItem('lastReadSurah');
      return saved ? JSON.parse(saved).number || 1 : 1;
    } catch { return 1; }
  });
  const [selectedJuz, setSelectedJuz] = useState(1);
  const [selectedHizb, setSelectedHizb] = useState(1);
  const [surah, setSurah] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingSurahs, setLoadingSurahs] = useState(true);
  const [loadingGroupedList, setLoadingGroupedList] = useState(false);
  const [error, setError] = useState(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showSurahSidebar, setShowSurahSidebar] = useState(true);
  const [showAyahSidebar, setShowAyahSidebar] = useState(true);
  const [surahSearch, setSurahSearch] = useState('');
  const [sidebarRefreshing, setSidebarRefreshing] = useState(false);
  const [ayahInput, setAyahInput] = useState('');
  const [surahWidth, setSurahWidth] = useState(240);
  const [ayahWidth, setAyahWidth] = useState(160);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);
  const draggingRef = useRef(null); // 'surah' | 'ayah'

  // ── Keyboard: ←/→ navigate, F fullscreen ──
  useEffect(() => {
    const handler = (e) => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (inInput) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const list = viewBy === 'surah' ? surahs : viewBy === 'juz' ? normalizedJuzs : normalizedHizbs;
        const selected = viewBy === 'surah' ? selectedSurah : viewBy === 'juz' ? selectedJuz : selectedHizb;
        const idx = list.findIndex(s => s.id === selected);
        if (e.key === 'ArrowLeft' && idx > 0) {
          const prevId = list[idx - 1].id;
          if (viewBy === 'surah') setSelectedSurah(prevId);
          if (viewBy === 'juz') setSelectedJuz(prevId);
          if (viewBy === 'hizb') setSelectedHizb(prevId);
        }
        if (e.key === 'ArrowRight' && idx < list.length - 1) {
          const nextId = list[idx + 1].id;
          if (viewBy === 'surah') setSelectedSurah(nextId);
          if (viewBy === 'juz') setSelectedJuz(nextId);
          if (viewBy === 'hizb') setSelectedHizb(nextId);
        }
      }
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) setFullscreen(v => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [surahs, juzs, hizbs, selectedSurah, selectedJuz, selectedHizb, viewBy]);

  useEffect(() => {
    setSidebarRefreshing(true);
    const timer = setTimeout(() => setSidebarRefreshing(false), 220);
    return () => clearTimeout(timer);
  }, [viewBy]);

  useEffect(() => {
    if (viewBy === 'surah') return;
    setShowBookmarks(false);
  }, [viewBy]);

  const onDragStart = (side) => (e) => {
    if (fullscreen) return;
    e.preventDefault();
    draggingRef.current = side;
    const startX = e.clientX;
    const startSurah = surahWidth;
    const startAyah = ayahWidth;
    const onMove = (mv) => {
      const dx = mv.clientX - startX;
      if (draggingRef.current === 'surah') {
        setSurahWidth(Math.max(160, Math.min(360, startSurah + dx)));
      } else {
        setAyahWidth(Math.max(120, Math.min(300, startAyah - dx)));
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Word-by-word data ──
  const [wordsData, setWordsData] = useState({});

  // ── Menu state ──
  const [openMenuAyah, setOpenMenuAyah] = useState(null);
  const menuAnchorRefs = useRef({});
  const ayahRefs = useRef({});
  const visibleAyahRef = useRef(1);
  const [activeAyahKey, setActiveAyahKey] = useState('');
  const ayahPanelRef = useRef(null);
  const surahListRef = useRef(null);
  const readerRef = useRef(null);
  const [wbwTooltip, setWbwTooltip] = useState(null); // { x, y, translit, meaning }

  const quranContentCacheRef = useRef(new Map());

  const currentSelectionNumber = viewBy === 'surah'
    ? selectedSurah
    : viewBy === 'juz'
      ? selectedJuz
      : selectedHizb;

  const formatVerseRef = (verseKey) => {
    const key = String(verseKey || '');
    if (!key.includes(':')) return '';
    const [chapterPart, versePart] = key.split(':');
    const chapterNumber = parseInt(chapterPart, 10);
    const chapterMeta = surahs.find(c => c.id === chapterNumber);
    const chapterLabel = chapterMeta?.name_simple || `Surah ${chapterPart}`;
    return `${chapterLabel} ${versePart}`;
  };

  const toArabicNumber = (value) => Number(value || 0).toLocaleString('ar-EG');

  const extractRangeLabel = (entry) => {
    const mapping = entry?.verse_mapping;
    if (mapping && typeof mapping === 'object') {
      const chapterKeys = Object.keys(mapping)
        .map(k => parseInt(k, 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (chapterKeys.length) {
        const firstChapter = chapterKeys[0];
        const lastChapter = chapterKeys[chapterKeys.length - 1];
        const firstRangeRaw = String(mapping[firstChapter] || '').split('-');
        const lastRangeRaw = String(mapping[lastChapter] || '').split('-');
        const firstVerse = firstRangeRaw[0] || '?';
        const lastVerse = lastRangeRaw[lastRangeRaw.length - 1] || '?';
        const firstName = surahs.find(c => c.id === firstChapter)?.name_simple || `Surah ${firstChapter}`;
        const lastName = surahs.find(c => c.id === lastChapter)?.name_simple || `Surah ${lastChapter}`;
        return {
          rangeLabel: `${firstName} ${firstVerse} - ${lastName} ${lastVerse}`,
          startLabel: `${firstName} ${firstVerse}`,
        };
      }
    }

    const firstKey = entry?.first_verse_key || entry?.first_verse?.verse_key;
    const lastKey = entry?.last_verse_key || entry?.last_verse?.verse_key;
    if (firstKey && lastKey) {
      return {
        rangeLabel: `${formatVerseRef(firstKey)} - ${formatVerseRef(lastKey)}`,
        startLabel: formatVerseRef(firstKey),
      };
    }

    return { rangeLabel: '', startLabel: '' };
  };

  const normalizedJuzs = juzs.map((entry, idx) => {
    const number = entry?.juz_number || entry?.id || idx + 1;
    const labels = extractRangeLabel(entry);
    return {
      id: number,
      number,
      title: `Juz ${number}`,
      subtitle: labels.rangeLabel || 'Range unavailable',
      startLabel: labels.startLabel || '',
      mono: true,
    };
  });

  const normalizedHizbs = hizbs.map((entry, idx) => {
    const number = entry?.hizb_number || entry?.id || idx + 1;
    const labels = extractRangeLabel(entry);
    return {
      id: number,
      number,
      title: `Hizb ${number}`,
      subtitle: labels.rangeLabel || labels.startLabel || 'Reference unavailable',
      startLabel: labels.startLabel || '',
      mono: true,
    };
  });

  const visibleSidebarItems = viewBy === 'surah' ? surahs : viewBy === 'juz' ? normalizedJuzs : normalizedHizbs;

  const showWbwTooltip = (e, translit, meaning) => {
    if (!translit && !meaning) return;
    const r = e.currentTarget.getBoundingClientRect();
    setWbwTooltip({ x: r.left + r.width / 2, y: r.top - 8, translit: translit || '', meaning: meaning || '' });
  };
  const hideWbwTooltip = () => setWbwTooltip(null);

  const getAyahKey = (ayah) => {
    if (!ayah) return '';
    return String(ayah.verseKey || `${ayah.chapterNumber || surah?.number || 0}:${ayah.numberInSurah || ayah.number || 0}`);
  };

  const normalizeQuranAudioUrl = (rawUrl) => {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('//')) return `https:${value}`;
    return `https://audio.qurancdn.com/${value.replace(/^\/+/, '')}`;
  };

  // ── Reading position tracking ──
  useEffect(() => {
    if (!surah || !readerRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const ayahKey = String(entry.target.dataset.ayahkey || '');
          const ayahNum = parseInt(entry.target.dataset.ayahnum || entry.target.dataset.ayah);
          if (!isNaN(ayahNum)) {
            visibleAyahRef.current = ayahNum;
            setActiveAyahKey(ayahKey);
          }
        }
      });
    }, { root: readerRef.current, threshold: 0.5 });

    Object.values(ayahRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [surah]);

  // Save reading position on unmount or surah change
  useEffect(() => {
    if (viewBy !== 'surah') return;
    return () => {
      if (surah) {
        localStorage.setItem('lastReadSurah', JSON.stringify({
          number: surah.number, name: surah.englishName, ayah: visibleAyahRef.current
        }));
      }
    };
  }, [surah, viewBy]);

  // Scroll to last-read ayah on load
  useEffect(() => {
    if (viewBy !== 'surah') return;
    if (!surah) return;
    try {
      const saved = JSON.parse(localStorage.getItem('lastReadSurah') || '{}');
      if (saved.number === surah.number && saved.ayah > 1) {
        const el = ayahRefs.current[`${surah.number}:${saved.ayah}`];
        if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      }
    } catch {}
  }, [surah, viewBy]);

  // ── Audio via AppShell props ──
  const { audioState, audioMode, currentAyahAudio, selectedReciter, allReciters, surahInfo,
    stopAudio, playAudioUrl, setSelectedReciter, togglePlay, playSpecificAyah } = audioControls;

  const playAyah = (verseRef) => {
    if (!surah || !playSpecificAyah) return;
    playSpecificAyah(verseRef, {
      fallbackSurah: surah.number,
      surahName: surah.englishName,
      totalAyahs: surah.ayahs.length,
    });
  };

  const playSurah = () => {
    if (!surah) return;
    const isCurrentSurahAudio = surahInfo?.number === surah.number;
    if (audioMode === 'surah' && isCurrentSurahAudio) { togglePlay(); return; }

    // Prefer verse playlist for auto-follow; if unavailable, fall back to full chapter audio.
    fetch(`${API_BASE}/api/audio/verse/${selectedReciter}/${surah.number}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => {
        const files = data?.audio_files;
        if (!Array.isArray(files) || files.length === 0) throw new Error('No verse playlist');

        const ayahPlaylist = files
          .map(f => {
            const ayahPart = String(f?.verse_key || '').split(':')[1];
            const ayahNumber = Number(ayahPart);
            if (!ayahNumber || !f?.url) return null;
            const itemUrl = normalizeQuranAudioUrl(f.url);
            return { ayahNumber, url: itemUrl };
          })
          .filter(Boolean)
          .sort((a, b) => a.ayahNumber - b.ayahNumber);

        const first = ayahPlaylist[0];
        if (!first?.url) throw new Error('No playable ayah');

        playAudioUrl(
          first.url,
          { number: surah.number, name: surah.englishName, totalAyahs: surah.ayahs.length },
          'surah',
          first.ayahNumber,
          { ayahPlaylist, autoAdvance: true }
        );
      })
      .catch(() => {
        fetch(`${API_BASE}/api/audio/chapter/${selectedReciter}/${surah.number}`)
          .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
          .then(data => {
            const audioFile = data?.audio_file;
            if (!audioFile?.audio_url) throw new Error('No chapter audio');
            const audioUrl = normalizeQuranAudioUrl(audioFile.audio_url);
            playAudioUrl(
              audioUrl,
              { number: surah.number, name: surah.englishName, totalAyahs: surah.ayahs.length },
              'surah',
              null,
              { ayahPlaylist: null, autoAdvance: false }
            );
          })
          .catch(() => stopAudio());
      });
  };

  useEffect(() => { setOpenMenuAyah(null); }, [viewBy, selectedSurah, selectedJuz, selectedHizb]);

  useEffect(() => {
    fetch(`${API_BASE}/api/chapters`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => {
        if (data.chapters) {
          setSurahs(data.chapters.map(normalizeChapterFromApi));
        }
      })
      .catch(err => setError(`Failed to load chapters: ${err.message}`))
      .finally(() => setLoadingSurahs(false));
  }, []);

  useEffect(() => {
    if (viewBy === 'juz' && juzs.length === 0) {
      setLoadingGroupedList(true);
      fetch(`${API_BASE}/api/juzs`)
        .then(r => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
        .then(data => setJuzs(Array.isArray(data?.juzs) ? data.juzs : []))
        .catch(err => setError(`Failed to load juz list: ${err.message}`))
        .finally(() => setLoadingGroupedList(false));
    }

    if (viewBy === 'hizb' && hizbs.length === 0) {
      setLoadingGroupedList(true);
      fetch(`${API_BASE}/api/hizbs`)
        .then(r => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
        .then(data => setHizbs(Array.isArray(data?.hizbs) ? data.hizbs : []))
        .catch(err => setError(`Failed to load hizb list: ${err.message}`))
        .finally(() => setLoadingGroupedList(false));
    }
  }, [viewBy, juzs.length, hizbs.length]);

  useEffect(() => {
    if (viewBy === 'surah' && (!selectedSurah || surahs.length === 0)) return;
    if (viewBy === 'juz' && !selectedJuz) return;
    if (viewBy === 'hizb' && !selectedHizb) return;

    const selection = viewBy === 'surah' ? selectedSurah : viewBy === 'juz' ? selectedJuz : selectedHizb;
    const cacheKey = `${viewBy}:${selection}:${settings.translationId}:${settings.scriptStyle}`;
    if (quranContentCacheRef.current.has(cacheKey)) {
      setSurah(quranContentCacheRef.current.get(cacheKey));
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = viewBy === 'surah'
      ? `${API_BASE}/api/chapters/${selectedSurah}/verses/${settings.translationId}`
      : viewBy === 'juz'
        ? `${API_BASE}/api/juzs/${selectedJuz}/verses/${settings.translationId}`
        : `${API_BASE}/api/hizbs/${selectedHizb}/verses/${settings.translationId}`;

    fetch(endpoint)
      .then(r => {
        if (r.status === 404 && viewBy === 'surah') throw new Error('This surah is not yet available in the current API tier. Chapters 1-2 are available.');
        if (!r.ok) throw new Error(`Backend returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!data.verses) throw new Error('No verses found');
        const getArabicText = (v) => {
          if (settings.scriptStyle === 'indopak') return v.text_indopak || v.text_uthmani;
          if (settings.scriptStyle === 'simple') return v.text_simple || v.text_uthmani;
          return v.text_uthmani;
        };

        const activeMeta = viewBy === 'surah'
          ? surahs.find(s => s.id === selectedSurah)
          : viewBy === 'juz'
            ? normalizedJuzs.find(j => j.id === selectedJuz)
            : normalizedHizbs.find(h => h.id === selectedHizb);

        const built = {
          number: selection,
          contextType: viewBy,
          englishName: viewBy === 'surah' ? (activeMeta?.name_simple || 'Chapter') : (activeMeta?.title || 'Quran Section'),
          translated: viewBy === 'surah' ? (activeMeta?.translated || '') : (activeMeta?.subtitle || ''),
          name: viewBy === 'surah'
            ? (activeMeta?.name || 'سورة')
            : (viewBy === 'juz' ? `الجزء ${toArabicNumber(selection)}` : `الحزب ${toArabicNumber(selection)}`),
          detailLine: viewBy === 'surah'
            ? `Surah ${selection} · ${data.verses.length} Ayahs`
            : `${viewBy === 'juz' ? 'Juz' : 'Hizb'} ${selection} · ${data.verses.length} Ayahs`,
          ayahs: data.verses.map((v, idx) => {
            const verseKey = String(v.verse_key || '');
            const chapterNumber = v.chapter_number || v.chapter_id || (verseKey.includes(':') ? parseInt(verseKey.split(':')[0], 10) : null);
            const numberInSurah = v.verse_number_in_surah || (verseKey.includes(':') ? parseInt(verseKey.split(':')[1], 10) : null) || v.verse_number || idx + 1;
            return {
              number: v.verse_number || idx + 1,
              numberInSurah,
              chapterNumber,
              verseKey,
              text: getArabicText(v),
              translation: v.translation_text || 'Translation not available',
            };
          }),
        };

        quranContentCacheRef.current.set(cacheKey, built);
        setSurah(built);

        if (viewBy === 'surah') {
          recordVisitedSurah(selectedSurah, built.englishName);
          recordDailyGoalProgress(selectedSurah);
        }
      })
      .catch(err => setError(`Failed to load verses: ${err.message}`))
      .finally(() => setLoading(false));
  }, [viewBy, selectedSurah, selectedJuz, selectedHizb, surahs, juzs, hizbs, settings.translationId, settings.scriptStyle]);

  // ── Sync ayah panel scroll ──
  useEffect(() => {
    if (!ayahPanelRef.current) return;
    const activeBtn = ayahPanelRef.current.querySelector('.ayah-panel-btn.active');
    if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeAyahKey]);

  // Follow currently playing ayah automatically during playback.
  useEffect(() => {
    if (!surah || !currentAyahAudio || surahInfo?.number !== surah.number) return;
    const match = surah.ayahs.find(a => a.numberInSurah === currentAyahAudio && (a.chapterNumber || surah.number) === surahInfo?.number);
    const key = getAyahKey(match);
    const el = ayahRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveAyahKey(key);
      visibleAyahRef.current = currentAyahAudio;
    }
  }, [currentAyahAudio, surah, surahInfo]);

  // ── Fetch word-by-word data always when a surah is selected ──
  useEffect(() => {
    if (viewBy !== 'surah' || !selectedSurah) {
      setWordsData({});
      return;
    }
    fetch(`${API_BASE}/api/chapters/${selectedSurah}/words`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.words_by_verse) setWordsData(data.words_by_verse);
      })
      .catch(() => {});
  }, [viewBy, selectedSurah]);

  const spacingValues = {
    compact: { gap: '6px', padding: '14px 14px 10px 44px' },
    normal: { gap: '14px', padding: '26px 26px 18px 58px' },
    spacious: { gap: '22px', padding: '32px 32px 24px 68px' },
    'very-spacious': { gap: '32px', padding: '40px 40px 32px 76px' },
  };
  const currentSpacing = spacingValues[settings.spacing] || spacingValues.normal;
  const scriptClass = SCRIPT_CLASS_MAP[settings.scriptStyle] || 'script-uthmani';
  const scale = settings.globalTextScale || 1;

  const toggleMenu = (ayahKey) => {
    setOpenMenuAyah(prev => prev === ayahKey ? null : ayahKey);
  };

  const isCurrentSurahAudio = viewBy === 'surah' && surahInfo?.number === surah?.number;
  const isSurahPlaying = isCurrentSurahAudio && audioMode === 'surah' && audioState === 'playing';
  const isSurahPaused = isCurrentSurahAudio && audioMode === 'surah' && audioState === 'paused';
  const isSurahLoading = isCurrentSurahAudio && audioMode === 'surah' && audioState === 'loading';
  const showNowPlayingPill = isCurrentSurahAudio && !!currentAyahAudio && audioState !== 'idle';
  const nowPlayingStateClass = audioState === 'playing'
    ? 'playing'
    : audioState === 'paused'
      ? 'paused'
      : 'loading';
  const nowPlayingTotal = surah?.ayahs?.length || surahInfo?.totalAyahs || '?';
  const sidebarQuery = surahSearch.trim().toLowerCase();
  const selectedSidebarId = viewBy === 'surah' ? selectedSurah : viewBy === 'juz' ? selectedJuz : selectedHizb;
  const filteredSidebarItems = visibleSidebarItems.filter(item => {
    if (!sidebarQuery) return true;
    if (viewBy === 'surah') {
      return (
        item.name_simple.toLowerCase().includes(sidebarQuery) ||
        item.name.includes(sidebarQuery) ||
        String(item.chapter_number).includes(sidebarQuery)
      );
    }
    return (
      String(item.number).includes(sidebarQuery) ||
      String(item.title || '').toLowerCase().includes(sidebarQuery) ||
      String(item.subtitle || '').toLowerCase().includes(sidebarQuery) ||
      String(item.startLabel || '').toLowerCase().includes(sidebarQuery)
    );
  });
  const sidebarPlaceholder = viewBy === 'surah' ? 'Search surah or #' : viewBy === 'juz' ? 'Search juz or # (e.g. 2, 20)' : 'Search hizb or # (e.g. 2, 20)';
  const sidebarTitle = viewBy === 'surah' ? 'Surahs' : viewBy === 'juz' ? 'Juzs' : 'Hizbs';
  const leftSidebarWidth = showSurahSidebar ? `${surahWidth}px` : '0px';
  const leftHandleWidth = showSurahSidebar ? '8px' : '0px';
  const rightHandleWidth = showAyahSidebar ? '8px' : '0px';
  const rightSidebarWidth = showAyahSidebar ? `${ayahWidth}px` : '0px';

  useEffect(() => {
    if (viewBy !== 'surah' || !surahListRef.current || showBookmarks) return;
    if (typeof window !== 'undefined' && window.innerWidth > 900) return;

    const list = surahListRef.current;
    const activeItem = list.querySelector('.surah-item.active');
    if (!activeItem) return;

    const itemTop = activeItem.offsetTop;
    const itemBottom = itemTop + activeItem.offsetHeight;
    const visibleTop = list.scrollTop;
    const visibleBottom = visibleTop + list.clientHeight;

    if (itemTop < visibleTop || itemBottom > visibleBottom) {
      list.scrollTo({
        top: Math.max(0, itemTop - (list.clientHeight / 2) + (activeItem.offsetHeight / 2)),
        behavior: 'smooth',
      });
    }
  }, [viewBy, selectedSidebarId, filteredSidebarItems.length, showBookmarks]);

  return (
    <>
    <div className={`quran-screen layout-${settings.layoutMode}`}>
      <div
        className="quran-container"
        ref={containerRef}
        style={{ gridTemplateColumns: fullscreen ? '0px 0px 1fr 0px 0px' : `${leftSidebarWidth} ${leftHandleWidth} 1fr ${rightHandleWidth} ${rightSidebarWidth}` }}
        data-fullscreen={fullscreen ? 'true' : undefined}
      >

        {/* ─── Left Selector (View By) ─── */}
        <div className={`surah-selector-wrapper ${showSurahSidebar ? '' : 'is-hidden'}`}>
          <div className="surah-selector-header">
            <div className="surah-selector-title">{sidebarTitle}</div>
            {viewBy === 'surah' && (
              <button
                className={`bookmarks-toggle-btn ${showBookmarks ? 'active' : ''}`}
                onClick={() => setShowBookmarks(!showBookmarks)}
                title="Bookmarks"
                aria-label="Bookmarks"
              >
                <IconBookmarkFill filled={showBookmarks} />
              </button>
            )}
          </div>

          <div className="viewby-control">
            <div className="viewby-label">View By</div>
            <div className="viewby-tabs" role="tablist" aria-label="Quran View Mode">
              <button className={`viewby-tab ${viewBy === 'surah' ? 'active' : ''}`} onClick={() => setViewBy('surah')} role="tab" aria-selected={viewBy === 'surah'}>Surah</button>
              <button className={`viewby-tab ${viewBy === 'juz' ? 'active' : ''}`} onClick={() => setViewBy('juz')} role="tab" aria-selected={viewBy === 'juz'}>Juz</button>
              <button className={`viewby-tab ${viewBy === 'hizb' ? 'active' : ''}`} onClick={() => setViewBy('hizb')} role="tab" aria-selected={viewBy === 'hizb'}>Hizb</button>
            </div>
          </div>

          {viewBy === 'surah' && showBookmarks ? (
            <BookmarksPanel onNavigate={(surahNum) => { setSelectedSurah(surahNum); setShowBookmarks(false); }} />
          ) : (
            <>
              <div className="sidebar-search-wrap">
                <input
                  type="text"
                  className="sidebar-search-input"
                  placeholder={sidebarPlaceholder}
                  value={surahSearch}
                  onChange={e => setSurahSearch(e.target.value)}
                />
              </div>
              <div className={`surah-list ${sidebarRefreshing ? 'list-refreshing' : ''}`} ref={surahListRef}>
                {loadingSurahs || loadingGroupedList ? (
                  <div className="skeleton-list">
                    {[...Array(10)].map((_, i) => <div key={i} className="skeleton-item" />)}
                  </div>
                ) : filteredSidebarItems.map(item => (
                  <button key={item.id}
                    className={`surah-item ${selectedSidebarId === item.id ? 'active' : ''}`}
                    onClick={() => {
                      if (viewBy === 'surah') setSelectedSurah(item.id);
                      if (viewBy === 'juz') setSelectedJuz(item.id);
                      if (viewBy === 'hizb') setSelectedHizb(item.id);
                      setSurahSearch('');
                    }}>
                    <span className="surah-item-number">{viewBy === 'surah' ? item.chapter_number : item.number}</span>
                    <div className="surah-item-text">
                      <div className="surah-item-name">{viewBy === 'surah' ? item.name_simple : item.title}</div>
                      <div className="surah-item-arabic">{viewBy === 'surah' ? item.name : item.subtitle}</div>
                      {viewBy !== 'surah' && item.startLabel && (
                        <div className="surah-item-meta">Starting Verse: {item.startLabel}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ─── Surah / Reader drag handle ─── */}
        <div className={`col-resize-handle ${showSurahSidebar ? '' : 'is-hidden'}`} onMouseDown={onDragStart('surah')} title="Drag to resize" />

        {/* ─── Quran Reader (main area, center) ─── */}
        <div className={`quran-reader view-${settings.viewMode}`} ref={readerRef}>
          {error && <div className="reader-error"><p>{error}</p></div>}

          {!error && surah && (
            <>
              <div className="reader-header">
                <h2 style={{ fontSize: `${2 * scale}rem` }}>{surah.englishName}</h2>
                {surah.translated && <p className="surah-translated">{surah.translated}</p>}
                <p className={`surah-arabic ${scriptClass}`}>{surah.name}</p>
                <p className="surah-info">{surah.detailLine || `Surah ${surah.number} · ${surah.ayahs.length} Ayahs`}</p>
                {showNowPlayingPill && (
                  <div className={`reader-now-playing-pill ${nowPlayingStateClass}`}>
                    Playing: Ayah {currentAyahAudio}/{nowPlayingTotal}
                  </div>
                )}

                <div className="surah-audio-bar">
                  {viewBy === 'surah' && (
                    <>
                      <button
                        className={`surah-play-btn ${isSurahPlaying ? 'playing' : ''} ${isSurahLoading ? 'loading' : ''}`}
                        onClick={playSurah}
                        disabled={isSurahLoading}
                      >
                        {isSurahLoading ? (
                          <><span className="surah-play-spinner" /> Loading...</>
                        ) : isSurahPlaying ? (
                          <><IconPause /> Pause Surah</>
                        ) : isSurahPaused ? (
                          <><IconPlaySmall /> Resume Surah</>
                        ) : (
                          <><IconPlaySmall /> Play Surah</>
                        )}
                      </button>
                      {(isSurahPlaying || isSurahPaused) && (
                        <button className="surah-stop-btn" onClick={stopAudio} title="Stop">
                          <IconStop />
                        </button>
                      )}
                      <ReciterPicker
                        reciters={allReciters}
                        selected={selectedReciter}
                        onChange={id => { stopAudio(); setSelectedReciter(id); }}
                      />
                    </>
                  )}
                  {/* Search & Fullscreen inline */}
                  <div className="reader-toolbar">
                      <button
                        className={`reader-toolbar-btn sidebar-toggle ${showSurahSidebar ? '' : 'active'}`}
                        onClick={() => setShowSurahSidebar(prev => !prev)}
                        title={showSurahSidebar ? 'Hide surah list' : 'Show surah list'}
                        aria-label={showSurahSidebar ? 'Hide surah list' : 'Show surah list'}
                      >
                        {showSurahSidebar ? <IconSidebarLeft /> : <IconSidebarRight />}
                      </button>
                      <button
                        className={`reader-toolbar-btn sidebar-toggle ${showAyahSidebar ? '' : 'active'}`}
                        onClick={() => setShowAyahSidebar(prev => !prev)}
                        title={showAyahSidebar ? 'Hide ayah list' : 'Show ayah list'}
                        aria-label={showAyahSidebar ? 'Hide ayah list' : 'Show ayah list'}
                      >
                        {showAyahSidebar ? <IconSidebarRight /> : <IconSidebarLeft />}
                      </button>
                    <button className="reader-toolbar-btn" onClick={() => onOpenSearch?.()}
                      title="Search Quran (Ctrl+F or /)"><IconSearchLarge /></button>
                    <button className="reader-toolbar-btn" onClick={() => setFullscreen(v => !v)}
                      title={fullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}>
                      {fullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
                    </button>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="skeleton-verses">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="skeleton-ayah">
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line medium" />
                      <div className="skeleton-line narrow" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                {settings.tajweedMode && (
                  <div className="tajweed-legend">
                    <h4 className="tajweed-legend-title">Tajweed Color Key</h4>
                    <div className="tajweed-legend-grid">
                      <span className="tajweed-legend-item"><span className="tajweed-dot qalaqah" style={{background:'#FF4D4D'}} />Qalqalah</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot ikhfa" style={{background:'#FF44DD'}} />Ikhfa</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot idghaam_ghunnah" style={{background:'#44FF88'}} />Idghaam</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot iqlaab" style={{background:'#00E5FF'}} />Iqlaab</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot ghunnah" style={{background:'#FFAA00'}} />Ghunnah</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot madda_normal" style={{background:'#7AACFF'}} />Madd Normal</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot madda_permissible" style={{background:'#AABFFF'}} />Madd Permissible</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot madda_obligatory" style={{background:'#5577FF'}} />Madd Obligatory</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot idghaam_mutajanisayn" style={{background:'#DDFF00'}} />Idghaam Mutajanisayn</span>
                      <span className="tajweed-legend-item"><span className="tajweed-dot ham_wasl" style={{background:'#D0D0D0'}} />Silent / Hamzat Wasl</span>
                    </div>
                  </div>
                )}
                <div className="ayahs-container" style={{ gap: currentSpacing.gap }}>
                  {surah.ayahs.map(ayah => {
                    const ayahKey = getAyahKey(ayah);
                    const ayahChapter = ayah.chapterNumber || surah.number;
                    const isMenuOpen = openMenuAyah === ayahKey;
                    const isAyahPlaying = currentAyahAudio === ayah.numberInSurah && audioState === 'playing' && surahInfo?.number === ayahChapter;
                    const isAyahActive = isMenuOpen || isAyahPlaying;
                    if (!menuAnchorRefs.current[ayahKey]) {
                      menuAnchorRefs.current[ayahKey] = { current: null };
                    }
                    return (
                      <div key={ayahKey}
                        data-ayah={ayah.number}
                        data-ayahkey={ayahKey}
                        data-ayahnum={ayah.numberInSurah}
                        ref={el => { ayahRefs.current[ayahKey] = el; }}
                        className={`ayah-card ${settings.viewMode === 'flat' ? 'flat' : ''} ${isAyahActive ? 'ayah-active' : ''}`}
                        style={{ padding: currentSpacing.padding }}>
                        {settings.showAyahBadges && (
                          <button 
                            className="ayah-number"
                            onClick={e => { e.stopPropagation(); toggleMenu(ayahKey); }}
                            title="Ayah menu"
                          >
                            {ayah.numberInSurah}
                          </button>
                        )}
                        <button
                          className={`ayah-more-btn ${isMenuOpen ? 'open' : ''}`}
                          ref={el => { menuAnchorRefs.current[ayahKey].current = el; }}
                          onClick={e => { e.stopPropagation(); toggleMenu(ayahKey); }}
                          title="Ayah actions"
                        >
                          <IconMoreVert />
                        </button>
                        {wordsData[ayah.numberInSurah]?.words?.length ? (
                          <div className={`arabic-text wbw-container ${settings.tajweedMode ? 'tajweed-text' : ''} ${scriptClass}`}
                            style={{ fontSize: `${settings.arabicSize * scale}rem`, lineHeight: settings.arabicLineHeight }}>
                            {wordsData[ayah.numberInSurah].words.map((w, wi) => (
                              <span
                                key={wi}
                                className={`wbw-word ${w.char_type === 'end' ? 'wbw-end' : ''}`}
                                onMouseEnter={w.char_type !== 'end'
                                  ? (e) => showWbwTooltip(e, w.transliteration, w.translation)
                                  : undefined}
                                onMouseLeave={hideWbwTooltip}
                              >
                                {settings.tajweedMode
                                  ? <span className="wbw-arabic" dangerouslySetInnerHTML={{ __html: w.tajweed || w.text }} />
                                  : <span className="wbw-arabic">{w.text}</span>
                                }
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className={`arabic-text ${scriptClass}`}
                            style={{
                              fontSize: `${settings.arabicSize * scale}rem`,
                              lineHeight: settings.arabicLineHeight,
                            }}>
                            {ayah.text}
                          </p>
                        )}
                        {settings.showTranslation && (
                          <p className="translation-text"
                            style={{
                              fontSize: `${settings.translationSize * scale}rem`,
                              lineHeight: settings.translationLineHeight,
                            }}>
                            {ayah.translation}
                          </p>
                        )}
                        {isMenuOpen && (
                          <AyahDropdownMenu
                            ayah={ayah}
                            surahNumber={ayah.chapterNumber || surah.number}
                            surahName={surah.englishName}
                            anchorRef={menuAnchorRefs.current[ayahKey]}
                            onClose={() => setOpenMenuAyah(null)}
                            onPlayAyah={playAyah}
                            ayahPlaying={isAyahPlaying}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ─── Reader / Ayah drag handle ─── */}
        <div className={`col-resize-handle ${showAyahSidebar ? '' : 'is-hidden'}`} onMouseDown={onDragStart('ayah')} title="Drag to resize" />

        {/* ─── Ayah Panel (right sidebar) ─── */}
        <div className={`ayah-panel ${showAyahSidebar ? '' : 'is-hidden'}`}>
          <div className="ayah-panel-header">Ayahs</div>
          <div className="sidebar-search-wrap">
            <input
              type="number"
              className="sidebar-search-input"
              placeholder="Go to #"
              min={1}
              max={surah?.ayahs?.length || 999}
              value={ayahInput}
              onChange={e => {
                const v = e.target.value;
                setAyahInput(v);
                const n = parseInt(v);
                if (!isNaN(n) && n >= 1 && surah?.ayahs?.[n - 1]) {
                  const ayah = surah.ayahs[n - 1];
                  const key = getAyahKey(ayah);
                  const el = ayahRefs.current[key];
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setActiveAyahKey(key);
                  }
                }
              }}
            />
          </div>
          <div className="ayah-panel-list" ref={ayahPanelRef}>
            {surah?.ayahs?.length ? surah.ayahs.map(a => (
              <button
                key={getAyahKey(a)}
                className={`ayah-panel-btn ${activeAyahKey === getAyahKey(a) ? 'active' : ''}`}
                onClick={() => {
                  const key = getAyahKey(a);
                  const el = ayahRefs.current[key];
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setActiveAyahKey(key);
                  }
                }}
              >
                <span className="ayah-panel-num">{a.numberInSurah}</span>
              </button>
            )) : (
              <div className="ayah-panel-empty">Select a surah</div>
            )}
          </div>
        </div>

      </div>
    </div>

    {/* ─── Fixed word-by-word tooltip (escapes overflow:auto clipping) ─── */}
    {wbwTooltip && createPortal(
      <div className="wbw-fixed-tooltip" style={{ left: wbwTooltip.x, top: wbwTooltip.y }}>
        {wbwTooltip.translit && <span className="wbw-tooltip-translit">{wbwTooltip.translit}</span>}
        {wbwTooltip.meaning  && <span className="wbw-tooltip-meaning">{wbwTooltip.meaning}</span>}
      </div>,
      document.body
    )}
    </>  
  );
}

// ─── Salah — Premium Global Prayer Times ─────────────────── 

function Salah() {
  const { settings } = useSettings();
  const scale = settings.globalTextScale || 1;
  const scriptClass = SCRIPT_CLASS_MAP[settings.scriptStyle] || SCRIPT_CLASS_MAP.uthmani;

  const [location, setLocation] = useState(() => {
    try {
      const saved = localStorage.getItem('salahLocation');
      return saved ? JSON.parse(saved) : WORLD_CITIES[0];
    } catch { return WORLD_CITIES[0]; }
  });
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [calcMethod, setCalcMethod] = useState('MWL');
  const [madhab, setMadhab] = useState(() => localStorage.getItem('salahMadhab') || 'shafi');
  const [timeFormat, setTimeFormat] = useState(() => localStorage.getItem('salahTimeFormat') || '12');
  const [now, setNow] = useState(new Date());
  const [dateKey, setDateKey] = useState(() => new Date().toDateString());
  const [realTimes, setRealTimes] = useState(null);
  const [timesLoading, setTimesLoading] = useState(false);
  const [completedPrayers, setCompletedPrayers] = useState({});
  const [qiblaInfo, setQiblaInfo] = useState(null);
  const [qiblaLoading, setQiblaLoading] = useState(false);
  const [qiblaError, setQiblaError] = useState('');

  useEffect(() => {
    localStorage.setItem('salahLocation', JSON.stringify(location));
  }, [location]);

  useEffect(() => {
    localStorage.setItem('salahTimeFormat', timeFormat);
  }, [timeFormat]);

  useEffect(() => {
    localStorage.setItem('salahMadhab', madhab);
  }, [madhab]);

  const checklistKey = `${location.id}_${now.toDateString()}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('salahChecklist') || '{}');
      setCompletedPrayers(saved[checklistKey] || {});
    } catch {
      setCompletedPrayers({});
    }
  }, [checklistKey]);

  const togglePrayerDone = (key) => {
    setCompletedPrayers(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        const all = JSON.parse(localStorage.getItem('salahChecklist') || '{}');
        all[checklistKey] = next;
        localStorage.setItem('salahChecklist', JSON.stringify(all));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Re-fetch prayer times when the calendar date changes (midnight rollover)
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date().toDateString();
      setDateKey(prev => (prev !== d ? d : prev));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  const computeQibla = useCallback((lat, lng) => {
    const kaaba = { lat: 21.4225, lng: 39.8262 };
    const toRad = v => (v * Math.PI) / 180;
    const toDeg = v => (v * 180) / Math.PI;
    const phi1 = toRad(lat);
    const phi2 = toRad(kaaba.lat);
    const deltaLambda = toRad(kaaba.lng - lng);
    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

    const dLat = toRad(kaaba.lat - lat);
    const dLng = toRad(kaaba.lng - lng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat)) * Math.cos(toRad(kaaba.lat)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = 6371 * c;

    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const cardinal = cardinals[Math.round(bearing / 45) % 8];
    return { bearing, distanceKm, cardinal };
  }, []);

  const fetchQiblaForLocation = useCallback(() => {
    setQiblaLoading(true);
    setQiblaError('');
    const locationQuery = `${location.name}, ${location.country}`;
    fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(locationQuery)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not geocode selected location')))
      .then(data => {
        if (!Array.isArray(data) || !data[0]) throw new Error('Location not found');
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setQiblaInfo(computeQibla(lat, lng));
      })
      .catch(() => {
        setQiblaInfo(null);
        setQiblaError('Unavailable for this location right now');
      })
      .finally(() => setQiblaLoading(false));
  }, [location, computeQibla]);

  useEffect(() => {
    fetchQiblaForLocation();
  }, [fetchQiblaForLocation]);

  // Fetch real prayer times from Aladhan API via backend
  useEffect(() => {
    let cancelled = false;
    const method = CALC_METHODS.find(m => m.id === calcMethod);
    const methodId = method ? method.aladhan : 3;
    const school = MADHAB_OPTIONS.find(m => m.id === madhab)?.school ?? 0;
    setTimesLoading(true);
    fetch(`${API_BASE}/api/prayer-times?city=${encodeURIComponent(location.name)}&country=${encodeURIComponent(location.country)}&method=${methodId}&school=${school}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data?.data?.timings) {
          setRealTimes(data.data.timings);
        }
        setTimesLoading(false);
      })
      .catch(() => {
        if (!cancelled) setTimesLoading(false);
      });
    return () => { cancelled = true; };
  }, [location, calcMethod, madhab, dateKey]);

  // Build today's prayer schedule from real or mock times
  const parsePrayerTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
  };

  let prayers;
  if (realTimes) {
    const timeMap = [realTimes.Fajr, realTimes.Sunrise, realTimes.Dhuhr, realTimes.Asr, realTimes.Maghrib, realTimes.Isha];
    prayers = PRAYER_DEFS.map((d, i) => ({ ...d, time: parsePrayerTime(timeMap[i]) }));
  } else {
    const mockTimes = generateMockTimes(location.id);
    prayers = PRAYER_DEFS.map(d => ({ ...d, time: mockTimes[d.idx] }));
  }

  const nextPrayer = prayers.find(p => p.isPrayer && p.time > now);
  const prevPrayer = [...prayers].reverse().find(p => p.isPrayer && p.time <= now);
  const sunrise = prayers.find(p => p.key === 'sunrise');
  const sunset = prayers.find(p => p.key === 'maghrib');
  const isha = prayers.find(p => p.key === 'isha');
  const fajr = prayers.find(p => p.key === 'fajr');

  // Countdown
  const countdown = nextPrayer ? Math.max(0, nextPrayer.time.getTime() - now.getTime()) : 0;
  const cdH = Math.floor(countdown / 3600000);
  const cdM = Math.floor((countdown % 3600000) / 60000);
  const cdS = Math.floor((countdown % 60000) / 1000);

  // Progress between previous and next
  let progress = 0;
  if (nextPrayer && prevPrayer) {
    const total = nextPrayer.time.getTime() - prevPrayer.time.getTime();
    if (total > 0) progress = Math.min(100, ((now.getTime() - prevPrayer.time.getTime()) / total) * 100);
  }

  // Dates
  let hijriDate = '';
  try {
    hijriDate = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
  } catch {}
  const gregorianDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const isFriday = now.getDay() === 5;
  const daysToFriday = isFriday ? 0 : ((5 - now.getDay() + 7) % 7);

  const filteredCities = citySearch.trim()
    ? WORLD_CITIES.filter(c =>
        c.name.toLowerCase().includes(citySearch.toLowerCase()) ||
        c.country.toLowerCase().includes(citySearch.toLowerCase()))
    : WORLD_CITIES;

  const allPassed = !nextPrayer;
  const prayerCount = prayers.filter(p => p.isPrayer).length;
  const passedCount = prayers.filter(p => p.isPrayer && p.time <= now).length;
  const checkedCount = prayers.filter(p => p.isPrayer && completedPrayers[p.key]).length;
  const hour12 = timeFormat !== '24';
  const formatDisplayTime = (date) => formatPrayerTime(date, { hour12 });
  const currentTimeLabel = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12,
  });
  let qiyamStart = null;
  let qiyamWindow = '';
  if (sunset && fajr) {
    const nextFajr = new Date(fajr.time);
    if (nextFajr <= sunset.time) nextFajr.setDate(nextFajr.getDate() + 1);
    const nightLength = nextFajr.getTime() - sunset.time.getTime();
    qiyamStart = new Date(nextFajr.getTime() - nightLength / 3);
    qiyamWindow = formatDurationShort(nightLength);
  }
  const untilSunset = sunset ? Math.max(0, sunset.time.getTime() - now.getTime()) : 0;
  const hijriInfo = getHijriInfo(now);
  const moonInfo = getMoonPhaseInfo(now);

  return (
    <div className="salah-page" style={{ fontSize: `${scale}rem` }}>

      {/* ── Location Header (Full Width) ── */}
      <div className="salah-location">
        <div className="salah-location-main">
          <span className="salah-location-pin"><IconMapPin /></span>
          <div className="salah-location-text">
            <h3 className="salah-city">{location.name}, {location.country}</h3>
            <p className="salah-tz">{location.tz.replace(/_/g, ' ')}</p>
          </div>
          <button className="salah-location-btn" onClick={() => setShowLocationModal(true)}>Change</button>
        </div>
        <div className="salah-date-row">
          {hijriDate && <span className="salah-hijri">{hijriDate}</span>}
          {hijriDate && gregorianDate && <span className="salah-date-sep">&middot;</span>}
          <span className="salah-gregorian">{gregorianDate}</span>
        </div>
        {/* Location Metadata: Moon & Hijri */}
        <div className="salah-location-meta">
          <span className="salah-location-stat">{moonInfo.emoji} {moonInfo.name}</span>
          <span className="salah-location-stat">{hijriInfo?.monthArabic || 'Islamic month'} {hijriInfo?.year || '--'} AH</span>
        </div>
      </div>

      {/* Main Summary: centered across both columns */}
      <div className="salah-summary">
        <span>{prayerCount} daily prayers</span>
        <span className="salah-summary-dot">&middot;</span>
        <span>{passedCount} completed</span>
        <span className="salah-summary-dot">&middot;</span>
        <span>{checkedCount} checked off</span>
      </div>

      {/* Balanced two-column layout */}
      <div className="salah-main-grid">
      {/* LEFT COLUMN: Prayer Schedule */}
      <div className="salah-schedule-column">

        {/* Prayer Schedule List */}
        <div className="salah-schedule">
          <div className="salah-schedule-label">Today&rsquo;s Schedule</div>
          <div className="salah-schedule-list">
            {prayers.map(p => {
              const isPassed = p.time <= now;
              const isNext = nextPrayer && p.key === nextPrayer.key;
              return (
                <div key={p.key} className={`salah-row ${isPassed ? 'passed' : ''} ${isNext ? 'next' : ''} ${!p.isPrayer ? 'non-prayer' : ''}`}>
                  <div className="salah-row-left">
                    {isNext && <span className="salah-row-dot" />}
                    <span className="salah-row-name">{p.name}</span>
                    <span className={`salah-row-arabic ${scriptClass}`}>{p.arabic}</span>
                  </div>
                  <div className="salah-row-right">
                    <span className="salah-row-time">{formatDisplayTime(p.time)}</span>
                    {p.isPrayer && (
                      <button
                        className={`salah-check-btn ${completedPrayers[p.key] ? 'checked' : ''}`}
                        onClick={() => togglePrayerDone(p.key)}
                        aria-label={`Mark ${p.name} as ${completedPrayers[p.key] ? 'not completed' : 'completed'}`}
                        title={completedPrayers[p.key] ? 'Completed' : 'Mark completed'}
                      >
                        {completedPrayers[p.key] ? <IconCheck /> : null}
                      </button>
                    )}
                    {isPassed && p.isPrayer && <span className="salah-row-badge passed">Passed</span>}
                    {isNext && <span className="salah-row-badge next">Next</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Next Prayer + Qibla */}
      <div className="salah-center-column">
        {/* Next Prayer Countdown Card */}
        <div className={`salah-next-card ${allPassed ? 'completed' : ''}`}>
          {allPassed ? (
            <>
              <div className="salah-next-label">Today&rsquo;s Prayers</div>
              <div className="salah-next-name">Completed</div>
              <p className="salah-next-subtitle">All {prayerCount} prayers for today have passed</p>
            </>
          ) : (
            <>
              <div className="salah-next-label">Up Next</div>
              <div className="salah-next-name">{nextPrayer.name}</div>
              <div className={`salah-next-arabic ${scriptClass}`}>{nextPrayer.arabic}</div>
              <div className="salah-next-time">{formatDisplayTime(nextPrayer.time)}</div>
              <div className="salah-next-progress">
                <div className="salah-next-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="salah-next-countdown">
                {cdH > 0 && <span className="salah-cd-seg">{cdH}<small>h</small></span>}
                <span className="salah-cd-seg">{String(cdM).padStart(2, '0')}<small>m</small></span>
                <span className="salah-cd-seg">{String(cdS).padStart(2, '0')}<small>s</small></span>
              </div>
            </>
          )}
        </div>

        {/* Qibla Direction Card */}
        <div className="salah-qibla-card">
          <span className="salah-footer-icon"><IconCompass /></span>
          <span className="salah-footer-label">Qibla Direction</span>
          <div className="salah-qibla-content">
            {qiblaInfo && (
              <div className="salah-qibla-compass" aria-label="Qibla mini compass">
                <div
                  className="salah-qibla-needle"
                  style={{ transform: `translate(-50%, -100%) rotate(${qiblaInfo.bearing.toFixed(1)}deg)` }}
                />
                <div className="salah-qibla-center" />
                <span className="salah-qibla-n">N</span>
                <span className="salah-qibla-e">E</span>
                <span className="salah-qibla-s">S</span>
                <span className="salah-qibla-w">W</span>
              </div>
            )}
            <div className="salah-qibla-stats">
              {qiblaLoading ? (
                <span className="salah-footer-value">Calculating…</span>
              ) : qiblaInfo ? (
                <>
                  <span className="salah-footer-value">{qiblaInfo.bearing.toFixed(1)}° ({qiblaInfo.cardinal})</span>
                  <span className="salah-footer-value">{qiblaInfo.distanceKm.toFixed(0)} km to Kaaba</span>
                </>
              ) : (
                <span className="salah-footer-value">{qiblaError || 'Unavailable'}</span>
              )}
              <button className="salah-qibla-btn" onClick={fetchQiblaForLocation} disabled={qiblaLoading}>
                {qiblaLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* RIGHT COLUMN: Utilities Stacked (1fr) */}
      <div className="salah-right-column">
        {/* Local Time */}
        <div className="salah-utility-card">
          <span className="salah-insight-icon"><IconClock /></span>
          <span className="salah-insight-label">Local Time</span>
          <span className="salah-insight-value">{currentTimeLabel}</span>
          <span className="salah-insight-sub">{hour12 ? '12-hour' : '24-hour'}</span>
        </div>

        {/* Sunrise */}
        <div className="salah-utility-card">
          <span className="salah-insight-label">Sunrise</span>
          <span className="salah-insight-value">{sunrise ? formatDisplayTime(sunrise.time) : '--'}</span>
          <span className="salah-insight-sub">Start of daylight</span>
        </div>

        {/* Sunset */}
        <div className="salah-utility-card">
          <span className="salah-insight-label">Sunset</span>
          <span className="salah-insight-value">{sunset ? formatDisplayTime(sunset.time) : '--'}</span>
          <span className="salah-insight-sub">In {formatDurationShort(untilSunset)}</span>
        </div>

        {/* Last Third of Night */}
        <div className="salah-utility-card">
          <span className="salah-insight-label">Last Third</span>
          <span className="salah-insight-value">{qiyamStart ? formatDisplayTime(qiyamStart) : '--'}</span>
          <span className="salah-insight-sub">Night window {qiyamWindow || '--'}</span>
        </div>

        {/* Jumu'ah Info */}
        <div className="salah-utility-card">
          <span className="salah-footer-icon"><IconMasjid /></span>
          <span className="salah-footer-label">{isFriday ? "Jumu\u2019ah Today" : "Jumu\u2019ah"}</span>
          <span className="salah-footer-value">{isFriday ? 'At Dhuhr time' : `In ${daysToFriday} day${daysToFriday > 1 ? 's' : ''}`}</span>
        </div>
      </div>

      {/* Settings Row */}
      <div className="salah-method-row salah-footer-row">
        <div className="salah-footer-card">
          <span className="salah-footer-icon"><IconClock /></span>
          <span className="salah-footer-label">Local Time</span>
          <span className="salah-footer-value">{currentTimeLabel}</span>
          <span className="salah-footer-value">{hour12 ? '12-hour format' : '24-hour format'}</span>
        </div>
        <div className="salah-footer-card">
          <span className="salah-footer-icon"><IconMasjid /></span>
          <span className="salah-footer-label">{isFriday ? "Jumu\u2019ah Today" : "Jumu\u2019ah"}</span>
          <span className="salah-footer-value">{isFriday ? 'At Dhuhr time' : `In ${daysToFriday} day${daysToFriday > 1 ? 's' : ''}`}</span>
        </div>
      </div>

      {/* ── Calculation Method ── */}
      <div className="salah-method-row">
        <div className="salah-method-info">
          <span className="salah-method-label">Calculation</span>
          <select className="salah-method-select settings-select" value={calcMethod} onChange={e => setCalcMethod(e.target.value)}>
            {CALC_METHODS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="salah-method-info">
          <span className="salah-method-label">Madhab</span>
          <select className="salah-method-select settings-select" value={madhab} onChange={e => setMadhab(e.target.value)}>
            {MADHAB_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="salah-method-info">
          <span className="salah-method-label">Time Format</span>
          <select className="salah-method-select settings-select" value={timeFormat} onChange={e => setTimeFormat(e.target.value)}>
            <option value="12">12-hour</option>
            <option value="24">24-hour</option>
          </select>
        </div>
        <p className="salah-method-note">{realTimes ? '✓ Live prayer times from Aladhan API' : timesLoading ? 'Loading live times…' : 'Using estimated times · API unavailable'}</p>
      </div>

      {/* ── Location Modal ── */}
      {showLocationModal && (
        <div className="settings-overlay" onClick={() => { setShowLocationModal(false); setCitySearch(''); }}>
          <div className="salah-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>Select Location</h3>
              <button className="settings-close" onClick={() => { setShowLocationModal(false); setCitySearch(''); }}>&times;</button>
            </div>
            <div className="salah-modal-search">
              <span className="salah-modal-search-icon"><IconSearchSmall /></span>
              <input
                type="text"
                className="salah-modal-input"
                placeholder="Search city or country\u2026"
                value={citySearch}
                onChange={e => setCitySearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="salah-modal-list">
              {filteredCities.map(c => (
                <button
                  key={c.id}
                  className={`salah-modal-city ${location.id === c.id ? 'active' : ''}`}
                  onClick={() => { setLocation(c); setShowLocationModal(false); setCitySearch(''); }}
                >
                  <span className="salah-modal-city-name">{c.name}</span>
                  <span className="salah-modal-city-country">{c.country}</span>
                </button>
              ))}
              {filteredCities.length === 0 && (
                <p className="salah-modal-empty">No cities found for &ldquo;{citySearch}&rdquo;</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="salah-spacer" />
    </div>
  );
}

// ─── Explore — Premium Discovery Page ──────────────────────

const EXPLORE_TOPICS = [
  { id: 'patience', label: 'Patience', arabic: '\u0635\u0628\u0631', icon: '\u2736', verses: [
    { ref: '2:153', arabic: '\u064A\u0627 \u0623\u064E\u064A\u0651\u064F\u0647\u064E\u0627 \u0627\u0644\u0651\u064E\u0630\u064A\u0646\u064E \u0622\u0645\u064E\u0646\u0648\u0627 \u0627\u0633\u062A\u064E\u0639\u064A\u0646\u0648\u0627 \u0628\u0627\u0644\u0635\u0651\u064E\u0628\u0652\u0631\u0650 \u0648\u0627\u0644\u0635\u0651\u064E\u0644\u0627\u0629\u0650', translation: 'O you who believe, seek help through patience and prayer. Indeed, Allah is with the patient.' },
    { ref: '3:200', arabic: '\u064A\u0627 \u0623\u064E\u064A\u0651\u064F\u0647\u064E\u0627 \u0627\u0644\u0651\u064E\u0630\u064A\u0646\u064E \u0622\u0645\u064E\u0646\u0648\u0627 \u0627\u0635\u0652\u0628\u0650\u0631\u0648\u0627 \u0648\u0635\u0627\u0628\u0650\u0631\u0648\u0627', translation: 'O you who believe, be patient, endure, remain stationed, and fear Allah that you may be successful.' },
    { ref: '39:10', arabic: '\u0625\u0650\u0646\u0651\u064E\u0645\u0627 \u064A\u064F\u0648\u064E\u0641\u0651\u064E\u0649 \u0627\u0644\u0635\u0651\u0627\u0628\u0650\u0631\u064F\u0648\u0646\u064E \u0623\u064E\u062C\u0652\u0631\u064E\u0647\u064F\u0645 \u0628\u0650\u063A\u064E\u064A\u0652\u0631\u0650 \u062D\u0650\u0633\u0627\u0628\u064D', translation: 'Indeed, the patient will be given their reward without account.' },
  ]},
  { id: 'gratitude', label: 'Gratitude', arabic: '\u0634\u0643\u0631', icon: '\u2726', verses: [
    { ref: '14:7', arabic: '\u0644\u064E\u0626\u0650\u0646 \u0634\u064E\u0643\u064E\u0631\u062A\u064F\u0645\u0652 \u0644\u064E\u0623\u064E\u0632\u064A\u062F\u064E\u0646\u0651\u064E\u0643\u064F\u0645\u0652', translation: 'If you are grateful, I will surely increase you [in favor].' },
    { ref: '31:12', arabic: '\u0648\u064E\u0645\u064E\u0646 \u064A\u064E\u0634\u0652\u0643\u064F\u0631\u0652 \u0641\u064E\u0625\u0650\u0646\u0651\u064E\u0645\u064E\u0627 \u064A\u064E\u0634\u0652\u0643\u064F\u0631\u064F \u0644\u0650\u0646\u064E\u0641\u0652\u0633\u0650\u0647\u0650', translation: 'And whoever is grateful is grateful for [the benefit of] himself.' },
    { ref: '2:152', arabic: '\u0641\u064E\u0627\u0630\u0652\u0643\u064F\u0631\u0648\u0646\u064A \u0623\u064E\u0630\u0652\u0643\u064F\u0631\u0652\u0643\u064F\u0645\u0652 \u0648\u064E\u0627\u0634\u0652\u0643\u064F\u0631\u0648\u0627 \u0644\u0650\u064A \u0648\u064E\u0644\u0627 \u062A\u064E\u0643\u0652\u0641\u064F\u0631\u0648\u0646\u0650', translation: 'So remember Me; I will remember you. And be grateful to Me and do not deny Me.' },
  ]},
  { id: 'hardship', label: 'Hardship', arabic: '\u0627\u0628\u062A\u0644\u0627\u0621', icon: '\u2737', verses: [
    { ref: '94:5-6', arabic: '\u0641\u064E\u0625\u0650\u0646\u0651\u064E \u0645\u064E\u0639\u064E \u0671\u0644\u0652\u0639\u064F\u0633\u0652\u0631\u0650 \u064A\u064F\u0633\u0652\u0631\u064B\u0627 \u0625\u0650\u0646\u0651\u064E \u0645\u064E\u0639\u064E \u0671\u0644\u0652\u0639\u064F\u0633\u0652\u0631\u0650 \u064A\u064F\u0633\u0652\u0631\u064B\u0627', translation: 'For indeed, with hardship comes ease. Indeed, with hardship comes ease.' },
    { ref: '2:286', arabic: '\u0644\u0627 \u064A\u064F\u0643\u064E\u0644\u0651\u0650\u0641\u064F \u0627\u0644\u0644\u0651\u0647\u064F \u0646\u064E\u0641\u0652\u0633\u064B\u0627 \u0625\u0650\u0644\u0651\u0627 \u0648\u064F\u0633\u0652\u0639\u064E\u0647\u0627', translation: 'Allah does not burden a soul beyond that it can bear.' },
    { ref: '65:7', arabic: '\u0633\u064E\u064A\u064E\u062C\u0652\u0639\u064E\u0644\u064F \u0627\u0644\u0644\u0651\u0647\u064F \u0628\u064E\u0639\u0652\u062F\u064E \u0639\u064F\u0633\u0652\u0631\u064D \u064A\u064F\u0633\u0652\u0631\u064B\u0627', translation: 'Allah will bring about, after hardship, ease.' },
  ]},
  { id: 'success', label: 'Success', arabic: '\u0641\u0644\u0627\u062D', icon: '\u2738', verses: [
    { ref: '23:1', arabic: '\u0642\u064E\u062F\u0652 \u0623\u064E\u0641\u0652\u0644\u064E\u062D\u064E \u0627\u0644\u0652\u0645\u064F\u0624\u0652\u0645\u0650\u0646\u064F\u0648\u0646\u064E', translation: 'Certainly will the believers have succeeded.' },
    { ref: '3:104', arabic: '\u0648\u064E\u0623\u064F\u0648\u0644\u064E\u0626\u0650\u0643\u064E \u0647\u064F\u0645\u064F \u0627\u0644\u0652\u0645\u064F\u0641\u0652\u0644\u0650\u062D\u064F\u0648\u0646\u064E', translation: 'And it is those who are the successful.' },
    { ref: '87:14', arabic: '\u0642\u064E\u062F\u0652 \u0623\u064E\u0641\u0652\u0644\u064E\u062D\u064E \u0645\u064E\u0646 \u062A\u064E\u0632\u064E\u0643\u0651\u064E\u0649', translation: 'He has certainly succeeded who purifies himself.' },
  ]},
  { id: 'prayer', label: 'Prayer', arabic: '\u0635\u0644\u0627\u0629', icon: '\u2741', verses: [
    { ref: '29:45', arabic: '\u0625\u0650\u0646\u0651\u064E \u0627\u0644\u0635\u0651\u064E\u0644\u0627\u0629\u064E \u062A\u064E\u0646\u0652\u0647\u0649 \u0639\u064E\u0646\u0650 \u0627\u0644\u0652\u0641\u064E\u062D\u0652\u0634\u0627\u0621\u0650 \u0648\u0627\u0644\u0652\u0645\u064F\u0646\u0643\u064E\u0631\u0650', translation: 'Indeed, prayer prohibits immorality and wrongdoing.' },
    { ref: '2:238', arabic: '\u062D\u0627\u0641\u0650\u0638\u0648\u0627 \u0639\u064E\u0644\u064E\u0649 \u0627\u0644\u0635\u0651\u064E\u0644\u064E\u0648\u0627\u062A\u0650 \u0648\u0627\u0644\u0635\u0651\u064E\u0644\u0627\u0629\u0650 \u0627\u0644\u0652\u0648\u064F\u0633\u0652\u0637\u0649', translation: 'Maintain with care the [obligatory] prayers and [in particular] the middle prayer.' },
    { ref: '20:14', arabic: '\u0648\u064E\u0623\u064E\u0642\u0650\u0645\u0650 \u0627\u0644\u0635\u0651\u064E\u0644\u0627\u0629\u064E \u0644\u0650\u0630\u0650\u0643\u0631\u064A', translation: 'And establish prayer for My remembrance.' },
  ]},
  { id: 'mercy', label: 'Mercy', arabic: '\u0631\u062D\u0645\u0629', icon: '\u2740', verses: [
    { ref: '7:156', arabic: '\u0648\u064E\u0631\u064E\u062D\u0652\u0645\u064E\u062A\u064A \u0648\u064E\u0633\u0650\u0639\u064E\u062A\u0652 \u0643\u064F\u0644\u0651\u064E \u0634\u064E\u064A\u0652\u0621\u064D', translation: 'My mercy encompasses all things.' },
    { ref: '39:53', arabic: '\u0644\u0627 \u062A\u064E\u0642\u0652\u0646\u064E\u0637\u0648\u0627 \u0645\u0650\u0646 \u0631\u0651\u064E\u062D\u0652\u0645\u064E\u0629\u0650 \u0627\u0644\u0644\u0651\u0647\u0650', translation: 'Do not despair of the mercy of Allah. Indeed, Allah forgives all sins.' },
    { ref: '21:107', arabic: '\u0648\u064E\u0645\u0627 \u0623\u064E\u0631\u0652\u0633\u064E\u0644\u0652\u0646\u0627\u0643\u064E \u0625\u0650\u0644\u0651\u0627 \u0631\u064E\u062D\u0652\u0645\u064E\u0629\u064B \u0644\u0651\u0650\u0644\u0652\u0639\u0627\u0644\u064E\u0645\u064A\u0646\u064E', translation: 'And We have not sent you except as a mercy to the worlds.' },
  ]},
  { id: 'trust', label: 'Trust in Allah', arabic: '\u062A\u0648\u0643\u0644', icon: '\u2742', verses: [
    { ref: '65:3', arabic: '\u0648\u064E\u0645\u064E\u0646 \u064A\u064E\u062A\u064E\u0648\u064E\u0643\u0651\u064E\u0644\u0652 \u0639\u064E\u0644\u064E\u0649 \u0627\u0644\u0644\u0651\u0647\u0650 \u0641\u064E\u0647\u064F\u0648\u064E \u062D\u064E\u0633\u0652\u0628\u064F\u0647\u064F', translation: 'And whoever relies upon Allah, then He is sufficient for him.' },
    { ref: '3:159', arabic: '\u0641\u064E\u0625\u0650\u0630\u0627 \u0639\u064E\u0632\u064E\u0645\u0652\u062A\u064E \u0641\u064E\u062A\u064E\u0648\u064E\u0643\u0651\u064E\u0644\u0652 \u0639\u064E\u0644\u064E\u0649 \u0627\u0644\u0644\u0651\u0647\u0650', translation: 'Then when you have decided, rely upon Allah. Indeed, Allah loves those who rely [upon Him].' },
    { ref: '8:2', arabic: '\u0648\u064E\u0639\u064E\u0644\u064E\u0649 \u0631\u064E\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u064A\u064E\u062A\u064E\u0648\u064E\u0643\u0651\u064E\u0644\u064F\u0648\u0646\u064E', translation: 'And upon their Lord they rely.' },
  ]},
  { id: 'forgiveness', label: 'Forgiveness', arabic: '\u0645\u063A\u0641\u0631\u0629', icon: '\u2749', verses: [
    { ref: '4:110', arabic: '\u0648\u064E\u0645\u064E\u0646 \u064A\u064E\u0639\u0652\u0645\u064E\u0644\u0652 \u0633\u064F\u0648\u0621\u064B\u0627 \u0623\u064E\u0648\u0652 \u064A\u064E\u0638\u0652\u0644\u0650\u0645\u0652 \u0646\u064E\u0641\u0652\u0633\u064E\u0647\u064F \u062B\u064F\u0645\u0651\u064E \u064A\u064E\u0633\u0652\u062A\u064E\u063A\u0652\u0641\u0650\u0631\u0650 \u0627\u0644\u0644\u0651\u0647\u064E \u064A\u064E\u062C\u0650\u062F\u0650 \u0627\u0644\u0644\u0651\u0647\u064E \u063A\u064E\u0641\u064F\u0648\u0631\u064B\u0627 \u0631\u0651\u064E\u062D\u064A\u0645\u064B\u0627', translation: 'And whoever does a wrong or wrongs himself but then seeks forgiveness of Allah will find Allah Forgiving and Merciful.' },
    { ref: '3:135', arabic: '\u0648\u064E\u0627\u0644\u0651\u064E\u0630\u064A\u0646\u064E \u0625\u0650\u0630\u0627 \u0641\u064E\u0639\u064E\u0644\u0648\u0627 \u0641\u0627\u062D\u0650\u0634\u064E\u0629\u064B \u0623\u064E\u0648\u0652 \u0638\u064E\u0644\u064E\u0645\u0648\u0627 \u0623\u064E\u0646\u0641\u064F\u0633\u064E\u0647\u064F\u0645\u0652 \u0630\u064E\u0643\u064E\u0631\u0648\u0627 \u0627\u0644\u0644\u0651\u0647\u064E', translation: 'And those who, when they commit an immorality or wrong themselves, remember Allah and seek forgiveness.' },
    { ref: '71:10', arabic: '\u0641\u064E\u0642\u064F\u0644\u0652\u062A\u064F \u0627\u0633\u0652\u062A\u064E\u063A\u0652\u0641\u0650\u0631\u0648\u0627 \u0631\u064E\u0628\u0651\u064E\u0643\u064F\u0645\u0652 \u0625\u0650\u0646\u0651\u064E\u0647\u064F \u0643\u0627\u0646\u064E \u063A\u064E\u0641\u0651\u0627\u0631\u064B\u0627', translation: 'Ask forgiveness of your Lord. Indeed, He is ever a Perpetual Forgiver.' },
  ]},
];

const EXPLORE_FEELINGS = [
  { id: 'stressed', label: 'Stressed', desc: 'When life feels overwhelming', verses: [
    { ref: '94:5-6', arabic: '\u0641\u064E\u0625\u0650\u0646\u0651\u064E \u0645\u064E\u0639\u064E \u0671\u0644\u0652\u0639\u064F\u0633\u0652\u0631\u0650 \u064A\u064F\u0633\u0652\u0631\u064B\u0627', translation: 'For indeed, with hardship comes ease.', meaning: 'No matter how heavy the burden, relief is already on its way. Allah has paired every difficulty with ease -- not after it, but alongside it.' },
    { ref: '2:286', arabic: '\u0644\u0627 \u064A\u064F\u0643\u064E\u0644\u0651\u0650\u0641\u064F \u0627\u0644\u0644\u0651\u0647\u064F \u0646\u064E\u0641\u0652\u0633\u064B\u0627 \u0625\u0650\u0644\u0651\u0627 \u0648\u064F\u0633\u0652\u0639\u064E\u0647\u0627', translation: 'Allah does not burden a soul beyond that it can bear.', meaning: 'Whatever you are going through right now, you have the strength to endure it. Allah knows your capacity better than you do.' },
  ]},
  { id: 'sad', label: 'Sad', desc: 'When your heart feels heavy', verses: [
    { ref: '93:3-5', arabic: '\u0645\u0627 \u0648\u064E\u062F\u0651\u064E\u0639\u064E\u0643\u064E \u0631\u064E\u0628\u0651\u064F\u0643\u064E \u0648\u064E\u0645\u0627 \u0642\u064E\u0644\u0649 \u0648\u064E\u0644\u064E\u0644\u0622\u062E\u0650\u0631\u064E\u0629\u064F \u062E\u064E\u064A\u0631\u064C \u0644\u0651\u064E\u0643\u064E \u0645\u064E\u0646\u064E \u0627\u0644\u0623\u0648\u0644\u0649 \u0648\u064E\u0644\u064E\u0633\u064E\u0648\u0652\u0641\u064E \u064A\u064F\u0639\u0652\u0637\u064A\u0643\u064E \u0631\u064E\u0628\u0651\u064F\u0643\u064E \u0641\u064E\u062A\u064E\u0631\u0652\u0636\u0649', translation: 'Your Lord has not forsaken you, nor has He become displeased. And the Hereafter is better for you than the present. And your Lord is going to give you, and you will be satisfied.', meaning: 'Allah has not forgotten you. He is preparing something better. Your sadness is temporary, but His plan for you is eternal.' },
    { ref: '13:28', arabic: '\u0623\u064E\u0644\u0627 \u0628\u0650\u0630\u0650\u0643\u0652\u0631\u0650 \u0627\u0644\u0644\u0651\u0647\u0650 \u062A\u064E\u0637\u0652\u0645\u064E\u0626\u0650\u0646\u0651\u064F \u0627\u0644\u0652\u0642\u064F\u0644\u0648\u0628\u064F', translation: 'Verily, in the remembrance of Allah do hearts find rest.', meaning: 'When the world weighs on your heart, turn to dhikr. Peace is not found in circumstances -- it is found in connection with Allah.' },
  ]},
  { id: 'lost', label: 'Lost', desc: 'When you need direction', verses: [
    { ref: '93:7', arabic: '\u0648\u064E\u0648\u064E\u062C\u064E\u062F\u064E\u0643\u064E \u0636\u064E\u0627\u0644\u0651\u064B\u0627 \u0641\u064E\u0647\u064E\u062F\u0649', translation: 'And He found you lost and guided [you].', meaning: 'Feeling lost is not a sign of failure. Even the Prophet was guided through uncertainty. Allah guides those who sincerely seek Him.' },
    { ref: '29:69', arabic: '\u0648\u064E\u0627\u0644\u0651\u064E\u0630\u064A\u0646\u064E \u062C\u0627\u0647\u064E\u062F\u0648\u0627 \u0641\u064A\u0646\u0627 \u0644\u064E\u0646\u064E\u0647\u0652\u062F\u0650\u064A\u064E\u0646\u0651\u064E\u0647\u064F\u0645\u0652 \u0633\u064F\u0628\u064F\u0644\u064E\u0646\u0627', translation: 'And those who strive for Us -- We will surely guide them to Our ways.', meaning: 'The effort itself is what matters. When you try sincerely, Allah opens paths you could never have imagined.' },
  ]},
  { id: 'grateful', label: 'Grateful', desc: 'When your heart is full', verses: [
    { ref: '14:7', arabic: '\u0644\u064E\u0626\u0650\u0646 \u0634\u064E\u0643\u064E\u0631\u062A\u064F\u0645\u0652 \u0644\u064E\u0623\u064E\u0632\u064A\u062F\u064E\u0646\u0651\u064E\u0643\u064F\u0645\u0652', translation: 'If you are grateful, I will surely increase you [in favor].', meaning: 'Gratitude is not just a feeling -- it is a door to more. When you recognize blessings, Allah multiplies them.' },
    { ref: '55:13', arabic: '\u0641\u064E\u0628\u0650\u0623\u064E\u064A\u0651\u0650 \u0622\u0644\u0627\u0621\u0650 \u0631\u064E\u0628\u0651\u0650\u0643\u064F\u0645\u0627 \u062A\u064F\u0643\u064E\u0630\u0651\u0650\u0628\u0627\u0646\u0650', translation: 'So which of the favors of your Lord would you deny?', meaning: 'A beautiful reminder to pause and count. Every breath, every moment of peace -- they are all gifts from your Lord.' },
  ]},
  { id: 'motivated', label: 'Motivated', desc: 'When you want to grow', verses: [
    { ref: '13:11', arabic: '\u0625\u0650\u0646\u0651\u064E \u0627\u0644\u0644\u0651\u0647\u064E \u0644\u0627 \u064A\u064F\u063A\u064E\u064A\u0651\u0650\u0631\u064F \u0645\u0627 \u0628\u0650\u0642\u064E\u0648\u0652\u0645\u064D \u062D\u062A\u0651\u0649 \u064A\u064F\u063A\u064E\u064A\u0651\u0650\u0631\u0648\u0627 \u0645\u0627 \u0628\u0650\u0623\u064E\u0646\u0641\u064F\u0633\u0650\u0647\u0650\u0645\u0652', translation: 'Indeed, Allah will not change the condition of a people until they change what is in themselves.', meaning: 'Real change begins from within. Allah responds to effort -- take the first step and He will take ten towards you.' },
    { ref: '94:7-8', arabic: '\u0641\u064E\u0625\u0650\u0630\u0627 \u0641\u064E\u0631\u064E\u063A\u0652\u062A\u064E \u0641\u0627\u0646\u0635\u064E\u0628\u0652 \u0648\u0625\u0650\u0644\u0649 \u0631\u064E\u0628\u0651\u0650\u0643\u064E \u0641\u0627\u0631\u0652\u063A\u064E\u0628\u0652', translation: 'So when you have finished [your duties], then stand up [for worship]. And to your Lord direct [your] longing.', meaning: 'Finish strong. When one task is done, move to the next with devotion. Channel your drive towards what truly matters.' },
  ]},
  { id: 'anxious', label: 'Anxious', desc: 'When worry takes over', verses: [
    { ref: '65:3', arabic: '\u0648\u064E\u0645\u064E\u0646 \u064A\u064E\u062A\u064E\u0648\u064E\u0643\u0651\u064E\u0644\u0652 \u0639\u064E\u0644\u064E\u0649 \u0627\u0644\u0644\u0651\u0647\u0650 \u0641\u064E\u0647\u064F\u0648\u064E \u062D\u064E\u0633\u0652\u0628\u064F\u0647\u064F', translation: 'And whoever relies upon Allah, then He is sufficient for him.', meaning: 'You do not have to carry everything alone. Let go of the need to control every outcome. Place your trust in the One who controls all outcomes.' },
    { ref: '3:173', arabic: '\u062D\u064E\u0633\u0652\u0628\u064F\u0646\u0627 \u0627\u0644\u0644\u0651\u0647\u064F \u0648\u064E\u0646\u0650\u0639\u0652\u0645\u064E \u0627\u0644\u0652\u0648\u064E\u0643\u064A\u0644\u064F', translation: 'Sufficient for us is Allah, and He is the best Disposer of affairs.', meaning: 'This was the dua of the prophets in their hardest moments. It is a declaration of ultimate trust -- and ultimate peace.' },
  ]},
];

const EXPLORE_TAFSIR_PICKS = [
  { surah: 1, name: 'Al-Fatihah', desc: 'The Opening -- the most recited chapter', ayahCount: 7 },
  { surah: 36, name: 'Ya-Sin', desc: 'The Heart of the Quran', ayahCount: 83 },
  { surah: 55, name: 'Ar-Rahman', desc: 'The Most Merciful -- beauty and blessings', ayahCount: 78 },
  { surah: 67, name: 'Al-Mulk', desc: 'Sovereignty -- protection in the grave', ayahCount: 30 },
  { surah: 18, name: 'Al-Kahf', desc: 'The Cave -- stories of faith and trial', ayahCount: 110 },
  { surah: 112, name: 'Al-Ikhlas', desc: 'Pure Monotheism -- equal to a third of the Quran', ayahCount: 4 },
];

const EXPLORE_RECITERS_PREVIEW = [
  { id: 2, name: 'Abdul Basit (Mujawwad)', style: 'Classical', chapter: 1, chapterName: 'Al-Fatihah' },
  { id: 3, name: 'Abdur-Rahman as-Sudais', style: 'Powerful', chapter: 36, chapterName: 'Ya-Sin' },
  { id: 159, name: 'Maher al-Muaiqly', style: 'Melodic', chapter: 55, chapterName: 'Ar-Rahman' },
  { id: 13, name: 'Saad al-Ghamdi', style: 'Warm', chapter: 67, chapterName: 'Al-Mulk' },
  { id: 174, name: 'Yasser ad-Dussary', style: 'Soothing', chapter: 18, chapterName: 'Al-Kahf' },
];

// ─── Islamic Calendar Tool ─────────────────────────────────

function IslamicCalendarTool() {
  const [expanded, setExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const getHijriDate = (date) => {
    try {
      const hijri = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        year: 'numeric', month: 'long', day: 'numeric',
      }).format(date);
      const hijriParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        year: 'numeric', month: 'numeric', day: 'numeric',
      }).format(date);
      const arabicHijri = new Intl.DateTimeFormat('ar-u-ca-islamic-umalqura', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
      }).format(date);
      return { formatted: hijri, arabic: arabicHijri, parts: hijriParts };
    } catch {
      return { formatted: 'Unavailable', arabic: '', parts: '' };
    }
  };

  const getGregorianDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  const changeDate = (days) => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + days);
      return d;
    });
  };

  const hijri = getHijriDate(selectedDate);
  const gregorian = getGregorianDate(selectedDate);
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  if (!expanded) {
    return (
      <div className="explore-tool-card" onClick={() => setExpanded(true)} style={{ cursor: 'pointer' }}>
        <span className="explore-tool-icon"><IconClock /></span>
        <span className="explore-tool-label">Islamic Calendar</span>
        <span className="explore-tool-status">{getHijriDate(new Date()).formatted}</span>
      </div>
    );
  }

  return (
    <div className="explore-tool-card explore-tool-expanded">
      <div className="explore-tool-card-header" onClick={() => setExpanded(false)} style={{ cursor: 'pointer' }}>
        <span className="explore-tool-icon"><IconClock /></span>
        <span className="explore-tool-label">Islamic Calendar</span>
      </div>
      <div className="islamic-calendar-content">
        <p className="islamic-calendar-hijri">{hijri.formatted}</p>
        {hijri.arabic && <p className="islamic-calendar-arabic">{hijri.arabic}</p>}
        <p className="islamic-calendar-gregorian">{gregorian}</p>
        <div className="islamic-calendar-nav">
          <button className="islamic-calendar-btn" onClick={() => changeDate(-1)}>&larr; Prev Day</button>
          {!isToday && <button className="islamic-calendar-btn today" onClick={() => setSelectedDate(new Date())}>Today</button>}
          <button className="islamic-calendar-btn" onClick={() => changeDate(1)}>Next Day &rarr;</button>
        </div>
      </div>
    </div>
  );
}

function ExploreOfficialDirectoryTool({ type }) {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('both');
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const [sourcePolicy, setSourcePolicy] = useState('');
  const [items, setItems] = useState([]);

  const isMosque = type === 'mosques';
  const endpoint = isMosque ? '/api/official/mosques' : '/api/official/halal';
  const label = isMosque ? 'Mosques Near Me (Official Directory)' : 'HMS / HFSAA Certified Halal Near Me';
  const subtitle = isMosque
    ? 'Uses Muslim directory source only (no Google Maps search)'
    : 'Uses certified-source listings from HMS and HFSAA only';

  const fetchOfficial = (q, source = sourceFilter) => {
    setLoading(true);
    setError('');
    const sourceParam = isMosque ? '' : `&source=${encodeURIComponent(source)}`;
    fetch(`${API_BASE}${endpoint}?q=${encodeURIComponent(q || '')}&limit=15${sourceParam}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load official listings')))
      .then(data => {
        setItems(Array.isArray(data.items) ? data.items : []);
        setSourcePolicy(data.sourcePolicy || '');
      })
      .catch((e) => {
        setError(e.message || 'Could not load official listings');
      })
      .finally(() => setLoading(false));
  };

  const detectAndSearch = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    setDetecting(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`)
          .then(r => r.ok ? r.json() : Promise.reject(new Error('Reverse geocode failed')))
          .then(data => {
            const city = data?.address?.city || data?.address?.town || data?.address?.county || '';
            const country = data?.address?.country || '';
            const locationQuery = [city, country].filter(Boolean).join(', ');
            const finalQuery = locationQuery || `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
            setQuery(finalQuery);
            fetchOfficial(finalQuery);
          })
          .catch(() => {
            const fallback = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
            setQuery(fallback);
            fetchOfficial(fallback);
          })
          .finally(() => setDetecting(false));
      },
      () => {
        setDetecting(false);
        setError('Could not get your location. Check browser permissions.');
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  return (
    <div className="explore-tool-card explore-nearme-card">
      <div className="explore-nearme-head">
        <span className="explore-tool-icon">{isMosque ? <IconMasjid /> : <IconFood />}</span>
        <span className="explore-tool-label">{label}</span>
      </div>
      <span className="explore-tool-status">{subtitle}</span>
      <div className="explore-nearme-actions">
        <input
          className="explore-nearme-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="City, state, or country"
        />
        {!isMosque && (
          <select
            className="explore-nearme-source-select"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            aria-label="Source filter"
          >
            <option value="hms">HMS only</option>
            <option value="hfsaa">HFSAA only</option>
            <option value="both">Both combined</option>
          </select>
        )}
        <button className="explore-nearme-btn" onClick={detectAndSearch} disabled={loading || detecting}>
          {detecting ? 'Locating...' : 'Use My Location'}
        </button>
        <button className="explore-nearme-btn solid" onClick={() => fetchOfficial(query, sourceFilter)} disabled={loading}>
          {loading ? 'Loading...' : 'Search Official Sources'}
        </button>
      </div>
      {!isMosque && sourcePolicy && <p className="explore-nearme-meta">{sourcePolicy}</p>}
      {error && <p className="explore-nearme-error">{error}</p>}
      {items.length > 0 && (
        <div className="explore-nearme-results">
          {items.map((item, idx) => (
            <div key={`${item.url}_${idx}`} className="explore-nearme-item">
              <div className="explore-nearme-item-top">
                {!isMosque && <span className="explore-nearme-source">{item.source}</span>}
                <span className="explore-nearme-status">{item.status}</span>
              </div>
              <div className="explore-nearme-name">{item.name}</div>
              {item.address && <div className="explore-nearme-address">{item.address}</div>}
              {item.phone && <div className="explore-nearme-phone">{item.phone}</div>}
              <a className="explore-nearme-link" href={item.url} target="_blank" rel="noopener noreferrer">
                View On Official Website
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExploreQiblaTool() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [qibla, setQibla] = useState(null);

  const KAABA = { lat: 21.4225, lng: 39.8262 };
  const toRad = (v) => (v * Math.PI) / 180;
  const toDeg = (v) => (v * 180) / Math.PI;

  const bearingToKaaba = (lat, lng) => {
    const phi1 = toRad(lat);
    const phi2 = toRad(KAABA.lat);
    const deltaLambda = toRad(KAABA.lng - lng);
    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  const distanceKm = (lat, lng) => {
    const R = 6371;
    const dLat = toRad(KAABA.lat - lat);
    const dLng = toRad(KAABA.lng - lng);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat)) * Math.cos(toRad(KAABA.lat)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const bearingToCardinal = (deg) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(deg / 45) % 8];
  };

  const detectQibla = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    setLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const bearing = bearingToKaaba(lat, lng);
        setQibla({
          bearing,
          cardinal: bearingToCardinal(bearing),
          distance: distanceKm(lat, lng),
          lat,
          lng,
        });
        setLoading(false);
      },
      () => {
        setLoading(false);
        setError('Could not get your location. Check browser permissions.');
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  return (
    <div className="explore-tool-card explore-nearme-card explore-qibla-card">
      <div className="explore-nearme-head">
        <span className="explore-tool-icon"><IconCompass /></span>
        <span className="explore-tool-label">Qibla Direction</span>
      </div>
      <span className="explore-tool-status">Live bearing to the Kaaba from your current location</span>
      <div className="explore-nearme-actions">
        <button className="explore-nearme-btn solid" onClick={detectQibla} disabled={loading}>
          {loading ? 'Calculating...' : 'Find Qibla'}
        </button>
      </div>
      {qibla && (
        <>
          <div className="explore-qibla-compass" aria-label="Qibla compass">
            <div className="explore-qibla-needle" style={{ transform: `translate(-50%, -100%) rotate(${qibla.bearing.toFixed(1)}deg)` }} />
            <div className="explore-qibla-center" />
            <span className="explore-qibla-n">N</span>
            <span className="explore-qibla-e">E</span>
            <span className="explore-qibla-s">S</span>
            <span className="explore-qibla-w">W</span>
          </div>
          <p className="explore-nearme-meta">Face {qibla.bearing.toFixed(1)}° ({qibla.cardinal}) from true north</p>
          <p className="explore-nearme-meta">Distance to Kaaba: {qibla.distance.toFixed(0)} km</p>
        </>
      )}
      {error && <p className="explore-nearme-error">{error}</p>}
    </div>
  );
}

function Explore({ onNavigate }) {
  const { settings } = useSettings();
  const scale = settings.globalTextScale || 1;
  const scriptClass = SCRIPT_CLASS_MAP[settings.scriptStyle] || SCRIPT_CLASS_MAP.uthmani;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeTopic, setActiveTopic] = useState(null);
  const [activeFeeling, setActiveFeeling] = useState(null);
  const [activeTafsir, setActiveTafsir] = useState(null);
  const [tafsirData, setTafsirData] = useState(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [playingReciter, setPlayingReciter] = useState(null);
  const [audioRef] = useState({ current: null });
  const searchInputRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Search handler -- searches by surah name or keyword across chapters
  const handleSearch = (query) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query.trim()) { setSearchResults(null); return; }

    searchTimerRef.current = setTimeout(() => {
      setSearchLoading(true);
      const q = query.toLowerCase().trim();
      const results = [];

      // Search surah names
      Object.entries(ARABIC_NAMES).forEach(([id, arabic]) => {
        const num = parseInt(id);
        const chapterData = { 1:'Al-Fatihah',2:'Al-Baqarah',3:'Aal-Imran',4:'An-Nisa',5:'Al-Maidah',6:'Al-Anam',7:'Al-Araf',8:'Al-Anfal',9:'At-Tawbah',10:'Yunus',11:'Hud',12:'Yusuf',13:'Ar-Rad',14:'Ibrahim',15:'Al-Hijr',16:'An-Nahl',17:'Al-Isra',18:'Al-Kahf',19:'Maryam',20:'Taha',21:'Al-Anbiya',22:'Al-Hajj',23:'Al-Muminun',24:'An-Nur',25:'Al-Furqan',26:'Ash-Shuara',27:'An-Naml',28:'Al-Qasas',29:'Al-Ankabut',30:'Ar-Rum',31:'Luqman',32:'As-Sajdah',33:'Al-Ahzab',34:'Saba',35:'Fatir',36:'Ya-Sin',37:'As-Saffat',38:'Sad',39:'Az-Zumar',40:'Ghafir',41:'Fussilat',42:'Ash-Shura',43:'Az-Zukhruf',44:'Ad-Dukhan',45:'Al-Jathiyah',46:'Al-Ahqaf',47:'Muhammad',48:'Al-Fath',49:'Al-Hujurat',50:'Qaf',51:'Adh-Dhariyat',52:'At-Tur',53:'An-Najm',54:'Al-Qamar',55:'Ar-Rahman',56:'Al-Waqiah',57:'Al-Hadid',58:'Al-Mujadilah',59:'Al-Hashr',60:'Al-Mumtahinah',61:'As-Saff',62:"Al-Jumuah",63:'Al-Munafiqun',64:'At-Taghabun',65:'At-Talaq',66:'At-Tahrim',67:'Al-Mulk',68:'Al-Qalam',69:'Al-Haqqah',70:'Al-Maarij',71:'Nuh',72:'Al-Jinn',73:'Al-Muzzammil',74:'Al-Muddaththir',75:'Al-Qiyamah',76:'Al-Insan',77:'Al-Mursalat',78:'An-Naba',79:'An-Naziat',80:'Abasa',81:'At-Takwir',82:'Al-Infitar',83:'Al-Mutaffifin',84:'Al-Inshiqaq',85:'Al-Buruj',86:'At-Tariq',87:'Al-Ala',88:'Al-Ghashiyah',89:'Al-Fajr',90:'Al-Balad',91:'Ash-Shams',92:'Al-Lail',93:'Ad-Dhuha',94:'Ash-Sharh',95:'At-Tin',96:'Al-Alaq',97:'Al-Qadr',98:'Al-Bayyinah',99:'Az-Zalzalah',100:'Al-Adiyat',101:'Al-Qariah',102:'At-Takathur',103:'Al-Asr',104:'Al-Humazah',105:'Al-Fil',106:'Quraish',107:'Al-Maun',108:'Al-Kawthar',109:'Al-Kafirun',110:'An-Nasr',111:'Al-Masad',112:'Al-Ikhlas',113:'Al-Falaq',114:'An-Nas' };
        const name = chapterData[num] || '';
        if (name.toLowerCase().includes(q) || String(num) === q) {
          results.push({ type: 'surah', number: num, name, arabic });
        }
      });

      // Search within topics
      EXPLORE_TOPICS.forEach(topic => {
        if (topic.label.toLowerCase().includes(q) || topic.id.includes(q)) {
          topic.verses.forEach(v => {
            results.push({ type: 'verse', ref: v.ref, arabic: v.arabic, translation: v.translation, source: topic.label });
          });
        }
      });

      // Search within feelings
      EXPLORE_FEELINGS.forEach(feeling => {
        if (feeling.label.toLowerCase().includes(q) || feeling.desc.toLowerCase().includes(q)) {
          feeling.verses.forEach(v => {
            results.push({ type: 'verse', ref: v.ref, arabic: v.arabic, translation: v.translation, source: `I Feel ${feeling.label}` });
          });
        }
      });

      // Search verse references (e.g. "2:255")
      const refMatch = q.match(/^(\d+):(\d+)/);
      if (refMatch) {
        const allVerses = [...EXPLORE_TOPICS, ...EXPLORE_FEELINGS].flatMap(g => g.verses);
        allVerses.forEach(v => {
          if (v.ref.startsWith(q)) {
            results.push({ type: 'verse', ref: v.ref, arabic: v.arabic, translation: v.translation, source: 'Reference' });
          }
        });
      }

      // Sort: surahs by number first, then verses by reference
      results.sort((a, b) => {
        if (a.type === 'surah' && b.type === 'surah') return a.number - b.number;
        if (a.type === 'surah') return -1;
        if (b.type === 'surah') return 1;
        return 0;
      });
      setSearchResults(results.length > 0 ? results : []);
      setSearchLoading(false);
    }, 250);
  };

  // Load tafsir for a surah
  const loadTafsir = (surah) => {
    if (activeTafsir === surah) { setActiveTafsir(null); setTafsirData(null); return; }
    setActiveTafsir(surah);
    setTafsirLoading(true);
    setTafsirData(null);
    fetch(`${API_BASE}/api/tafsir/169/by_chapter/${surah}`)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(data => {
        const entries = (data?.tafsirs || []).slice(0, 5);
        setTafsirData(entries);
      })
      .catch(() => setTafsirData([]))
      .finally(() => setTafsirLoading(false));
  };

  // Audio preview
  const toggleReciterPreview = (reciter) => {
    if (playingReciter === reciter.id) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingReciter(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); }
    setPlayingReciter(reciter.id);
    const playUrl = (url) => {
      if (!url) return false;
      const audio = new Audio(url);
      audio.volume = 0.6;
      audio.onended = () => setPlayingReciter(null);
      audio.onerror = () => setPlayingReciter(null);
      audio.play().catch(() => setPlayingReciter(null));
      audioRef.current = audio;
      return true;
    };

    fetch(`${API_BASE}/api/audio/verse/${reciter.id}/${reciter.chapter}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const firstVerseUrl = data?.audio_files?.[0]?.url;
        if (firstVerseUrl && playUrl(normalizeQuranAudioUrl(firstVerseUrl))) return null;
        return fetch(`${API_BASE}/api/audio/chapter/${reciter.id}/${reciter.chapter}`);
      })
      .then(r => r && r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const url = normalizeQuranAudioUrl(data?.audio_file?.audio_url);
        if (url) playUrl(url);
        else setPlayingReciter(null);
      })
      .catch(() => setPlayingReciter(null));
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  const clearSearch = () => { setSearchQuery(''); setSearchResults(null); searchInputRef.current?.focus(); };

  return (
    <div className="explore-page" style={{ fontSize: `${scale}rem` }}>

      {/* Header */}
      <div className="explore-header">
        <h1 className="explore-title">Explore</h1>
        <p className="explore-subtitle">Discover, reflect, and grow with the Quran</p>
      </div>

      {/* Search */}
      <div className="explore-search-wrapper">
        <div className="explore-search-bar">
          <span className="explore-search-icon"><IconSearchSmall /></span>
          <input
            ref={searchInputRef}
            type="text"
            className="explore-search-input"
            placeholder="Search surahs, topics, verses..."
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            aria-label="Search the Quran"
          />
          {searchQuery && (
            <button className="explore-search-clear" onClick={clearSearch} aria-label="Clear search">
              <IconX />
            </button>
          )}
        </div>

        {/* Search Results */}
        {searchResults !== null && (
          <div className="explore-search-results">
            {searchLoading ? (
              <div className="explore-search-loading">Searching...</div>
            ) : searchResults.length === 0 ? (
              <div className="explore-search-empty">No results found. Try a different keyword.</div>
            ) : (
              <div className="explore-search-list">
                {searchResults.slice(0, 12).map((r, i) => (
                  <div key={`${r.type}-${r.ref || r.number}-${i}`}
                    className="explore-search-item"
                    onClick={() => { if (r.type === 'surah' && onNavigate) { onNavigate('quran', r.number); clearSearch(); } }}
                    style={r.type === 'surah' ? { cursor: 'pointer' } : undefined}
                  >
                    {r.type === 'surah' ? (
                      <>
                        <div className="explore-search-item-badge">{r.number}</div>
                        <div className="explore-search-item-content">
                          <span className="explore-search-item-name">{r.name}</span>
                          <span className={`explore-search-item-arabic ${scriptClass}`}>{r.arabic}</span>
                        </div>
                        <span className="explore-search-item-type">Surah</span>
                      </>
                    ) : (
                      <>
                        <div className="explore-search-item-badge-verse">{r.ref}</div>
                        <div className="explore-search-item-content">
                          <span className="explore-search-item-translation">{r.translation}</span>
                          <span className="explore-search-item-source">{r.source}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* I Feel Section */}
      <div className="explore-section">
        <h2 className="explore-section-title">I Feel...</h2>
        <p className="explore-section-desc">Select how you feel and find Quranic guidance</p>
        <div className="explore-feelings-grid">
          {EXPLORE_FEELINGS.map(f => (
            <button
              key={f.id}
              className={`explore-feeling-chip ${activeFeeling === f.id ? 'active' : ''}`}
              onClick={() => setActiveFeeling(activeFeeling === f.id ? null : f.id)}
            >
              <span className="explore-feeling-label">{f.label}</span>
              <span className="explore-feeling-desc">{f.desc}</span>
            </button>
          ))}
        </div>

        {/* Feeling Results */}
        {activeFeeling && (
          <div className="explore-feeling-results">
            {EXPLORE_FEELINGS.find(f => f.id === activeFeeling)?.verses.map((v, i) => (
              <div key={i} className="explore-verse-card">
                <div className="explore-verse-ref">{v.ref}</div>
                <p className={`explore-verse-arabic ${scriptClass}`} style={{
                  fontSize: `${settings.arabicSize * scale * 0.75}rem`,
                  lineHeight: settings.arabicLineHeight,
                }}>{v.arabic}</p>
                <p className="explore-verse-translation" style={{
                  fontSize: `${settings.translationSize * scale}rem`,
                  lineHeight: settings.translationLineHeight,
                }}>{v.translation}</p>
                {v.meaning && <p className="explore-verse-meaning">{v.meaning}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Topics / Themes */}
      <div className="explore-section">
        <h2 className="explore-section-title">Topics</h2>
        <p className="explore-section-desc">Explore the Quran by theme</p>
        <div className="explore-topics-grid">
          {EXPLORE_TOPICS.map(t => (
            <button
              key={t.id}
              className={`explore-topic-card ${activeTopic === t.id ? 'active' : ''}`}
              onClick={() => setActiveTopic(activeTopic === t.id ? null : t.id)}
            >
              <span className="explore-topic-icon">{(() => { const Icon = TOPIC_ICONS[t.id]; return Icon ? <Icon /> : t.icon; })()}</span>
              <span className="explore-topic-label">{t.label}</span>
              <span className={`explore-topic-arabic ${scriptClass}`}>{t.arabic}</span>
            </button>
          ))}
        </div>

        {/* Topic Results */}
        {activeTopic && (
          <div className="explore-topic-results">
            {EXPLORE_TOPICS.find(t => t.id === activeTopic)?.verses.map((v, i) => (
              <div key={i} className="explore-verse-card">
                <div className="explore-verse-ref">{v.ref}</div>
                <p className={`explore-verse-arabic ${scriptClass}`} style={{
                  fontSize: `${settings.arabicSize * scale * 0.75}rem`,
                  lineHeight: settings.arabicLineHeight,
                }}>{v.arabic}</p>
                <p className="explore-verse-translation" style={{
                  fontSize: `${settings.translationSize * scale}rem`,
                  lineHeight: settings.translationLineHeight,
                }}>{v.translation}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tafsir / Learn */}
      <div className="explore-section">
        <h2 className="explore-section-title">Learn</h2>
        <p className="explore-section-desc">Explore tafsir and deepen your understanding</p>
        <div className="explore-tafsir-grid">
          {EXPLORE_TAFSIR_PICKS.map(t => (
            <button
              key={t.surah}
              className={`explore-tafsir-card ${activeTafsir === t.surah ? 'active' : ''}`}
              onClick={() => loadTafsir(t.surah)}
            >
              <div className="explore-tafsir-card-num">{t.surah}</div>
              <div className="explore-tafsir-card-info">
                <span className="explore-tafsir-card-name">{t.name}</span>
                <span className="explore-tafsir-card-desc">{t.desc}</span>
              </div>
              <span className="explore-tafsir-card-arrow"><IconChevron /></span>
            </button>
          ))}
        </div>

        {/* Tafsir Content */}
        {activeTafsir && (
          <div className="explore-tafsir-content">
            {tafsirLoading ? (
              <div className="explore-tafsir-loading">Loading tafsir...</div>
            ) : tafsirData && tafsirData.length > 0 ? (
              tafsirData.map((t, i) => (
                <div key={i} className="explore-tafsir-entry">
                  <div className="explore-tafsir-entry-key">{t.verse_key || `Ayah ${t.verse_number || i + 1}`}</div>
                  <div className="explore-tafsir-entry-text" dangerouslySetInnerHTML={{ __html: t.text }} />
                </div>
              ))
            ) : (
              <div className="explore-tafsir-empty">Tafsir not available. Make sure the backend server is running.</div>
            )}
          </div>
        )}
      </div>

      {/* Listen */}
      <div className="explore-section">
        <h2 className="explore-section-title">Listen</h2>
        <p className="explore-section-desc">Preview recitations from renowned reciters</p>
        <div className="explore-listen-grid">
          {EXPLORE_RECITERS_PREVIEW.map(r => (
            <button
              key={r.id}
              className={`explore-listen-card ${playingReciter === r.id ? 'playing' : ''}`}
              onClick={() => toggleReciterPreview(r)}
            >
              <div className="explore-listen-card-play">
                {playingReciter === r.id ? <IconPause /> : <IconPlaySmall />}
              </div>
              <div className="explore-listen-card-info">
                <span className="explore-listen-card-name">{r.name}</span>
                <span className="explore-listen-card-detail">{r.style} -- {r.chapterName}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tools */}
      <div className="explore-section">
        <h2 className="explore-section-title">Tools</h2>
        <div className="explore-tools-grid">
          <ExploreOfficialDirectoryTool type="mosques" />
          <ExploreOfficialDirectoryTool type="foods" />
          <ExploreQiblaTool />
          <IslamicCalendarTool />
        </div>
      </div>

      <div className="explore-spacer" />
    </div>
  );
}

// ─── Quran-Wide Search ─────────────────────────────────────

function QuranSearch({ onNavigate, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [total, setTotal] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  // Close on Escape
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q.trim())}&translations=${settings.translationId}&size=30`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const raw = data.search?.results || data.results || [];
      setTotal(data.search?.total_results || raw.length);
      setResults(raw);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 450);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  const highlightMatch = (text, q) => {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.length > 200 ? text.slice(0, 200) + '…' : text;
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + q.length + 80);
    const pre = (start > 0 ? '…' : '') + text.slice(start, idx);
    const match = text.slice(idx, idx + q.length);
    const post = text.slice(idx + q.length, end) + (end < text.length ? '…' : '');
    return <>{pre}<mark className="qsearch-mark">{match}</mark>{post}</>;
  };

  return (
    <div className="qsearch-overlay" onClick={onClose}>
      <div className="qsearch-modal" onClick={e => e.stopPropagation()}>
        <div className="qsearch-header">
          <div className="qsearch-input-wrap">
            <IconSearchLarge />
            <input
              ref={inputRef}
              className="qsearch-input"
              placeholder="Search the Quran — English or Arabic…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {loading && <span className="qsearch-spin" />}
          </div>
          <button className="qsearch-close-btn" onClick={onClose}><IconX /></button>
        </div>

        <div className="qsearch-body">
          {!searched && (
            <div className="qsearch-hint">
              <div className="qsearch-hint-icon">🔍</div>
              <p>Search across all 114 surahs</p>
              <p className="qsearch-hint-sub">Try "mercy", "patience", "paradise", or "الرحمن"</p>
              <div className="qsearch-chips">
                {['mercy', 'patience', 'paradise', 'forgiveness', 'prayer'].map(w => (
                  <button key={w} className="qsearch-chip" onClick={() => setQuery(w)}>{w}</button>
                ))}
              </div>
            </div>
          )}

          {searched && !loading && results.length === 0 && (
            <div className="qsearch-empty">
              <span style={{ fontSize: 28 }}>📭</span>
              <p>No results found for <strong>"{query}"</strong></p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="qsearch-count">{total > 30 ? `Showing 30 of ${total.toLocaleString()}` : `${total} result${total !== 1 ? 's' : ''}`} for <strong>"{query}"</strong></div>
              <div className="qsearch-results">
                {results.map((r, i) => {
                  const [chNum] = (r.verse_key || '').split(':');
                  const translationText = r.translations?.[0]?.text || r.text || '';
                  const cleanText = translationText.replace(/<[^>]+>/g, '');
                  return (
                    <button
                      key={i}
                      className="qsearch-result"
                      onClick={() => { onNavigate(parseInt(chNum)); onClose(); }}
                    >
                      <div className="qsearch-result-top">
                        <span className="qsearch-result-badge">{r.verse_key}</span>
                        {r.verse_key && (
                          <span className="qsearch-result-surah">
                            {ARABIC_NAMES[parseInt(chNum)] || ''}
                          </span>
                        )}
                      </div>
                      <div className="qsearch-result-text">{highlightMatch(cleanText, query)}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Global Audio Player Component ─────────────────────────

function GlobalAudioPlayer({ audio, onClose }) {
  const {
    currentTime,
    duration,
    playing,
    loading,
    surahName,
    surahNumber,
    ayahInfo,
    volume,
    repeatAyah,
    loopEnabled,
    speed,
    canPrevAyah,
    canNextAyah,
  } = audio;
  const [showVolume, setShowVolume] = useState(false);

  // ── Draggable position ──
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('playerPos');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const playerRef = useRef(null);

  const onDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = playerRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    setDragging(true);

    const onMove = (mv) => {
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, mv.clientX - offsetX));
      const y = Math.max(0, Math.min(window.innerHeight - rect.height, mv.clientY - offsetY));
      setPos({ x, y });
    };
    const onUp = () => {
      setDragging(false);
      setPos(prev => {
        if (prev) localStorage.setItem('playerPos', JSON.stringify(prev));
        return prev;
      });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const formatTime = (t) => {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const playerStyle = pos
    ? { bottom: 'auto', left: pos.x + 'px', top: pos.y + 'px', right: 'auto', transform: 'none' }
    : {};

  return (
    <div
      className={`global-player ${dragging ? 'dragging' : ''}`}
      ref={playerRef}
      style={playerStyle}
    >
      {/* Drag handle */}
      <div
        className="gp-drag-handle"
        ref={dragRef}
        onMouseDown={onDragStart}
        title="Drag to reposition player"
      >
        <IconDragHandle />
      </div>

      <div className="global-player-info">
        <span className="global-player-surah">{surahName || `Surah ${surahNumber}`}</span>
        {ayahInfo && <span className="global-player-ayah">{ayahInfo}</span>}
      </div>
      <div className="global-player-controls">
        <button
          className="gp-btn gp-transport"
          onClick={audio.onPrevAyah}
          title="Previous ayah"
          aria-label="Previous ayah"
          disabled={!canPrevAyah}
        >
          <IconSkipBack />
          <span className="gp-transport-label">Prev</span>
        </button>
        <button className="gp-btn gp-play" onClick={audio.onTogglePlay} title={playing ? 'Pause' : 'Play'}>
          {loading ? <span className="gp-spinner" /> : playing ? <IconPause /> : <IconPlaySmall />}
        </button>
        <button
          className="gp-btn gp-transport"
          onClick={audio.onNextAyah}
          title="Next ayah"
          aria-label="Next ayah"
          disabled={!canNextAyah}
        >
          <IconSkipForward />
          <span className="gp-transport-label">Next</span>
        </button>
      </div>
      <div className="global-player-timeline">
        <span className="gp-time">{formatTime(currentTime)}</span>
        <div className="gp-progress-bar" onClick={audio.onSeek}>
          <div className="gp-progress-fill" style={{ width: `${progress}%` }} />
          <div className="gp-progress-thumb" style={{ left: `${progress}%` }} />
        </div>
        <span className="gp-time">{formatTime(duration)}</span>
      </div>
      <div className="global-player-extra">
        <button
          className={`gp-btn gp-toggle-btn ${repeatAyah ? 'gp-repeat-active' : ''}`}
          onClick={audio.onToggleRepeatAyah}
          title={repeatAyah ? 'Disable repeat ayah' : 'Repeat current ayah'}
        >
          <span className="gp-toggle-label">Ayah</span>
        </button>
        <button
          className={`gp-btn gp-toggle-btn ${loopEnabled ? 'gp-repeat-active' : ''}`}
          onClick={audio.onToggleLoop}
          title={loopEnabled ? 'Disable Surah loop' : 'Repeat Surah'}
        >
          <IconRepeat />
          <span className="gp-toggle-label">Loop</span>
        </button>
        <select
          className="gp-speed-select"
          value={speed}
          onChange={e => audio.onSpeedChange(parseFloat(e.target.value))}
          title="Playback speed"
        >
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(v => (
            <option key={v} value={v}>{`${v}x`}</option>
          ))}
        </select>
        <div className="gp-volume-wrap">
          <button className="gp-btn" onClick={() => setShowVolume(!showVolume)} title="Volume"><IconVolume /></button>
          {showVolume && (
            <input type="range" className="gp-volume-slider" min="0" max="1" step="0.05"
              value={volume} onChange={e => audio.onVolumeChange(parseFloat(e.target.value))} />
          )}
        </div>
        <button className="gp-btn gp-close" onClick={onClose} title="Stop & Close"><IconX /></button>
      </div>
    </div>
  );
}

// ─── App Shell ─────────────────────────────────────────────

function AppShell({ tab, setTab }) {
  const { settings, updateSetting, showSettings, setShowSettings } = useSettings();
  const [pendingSurah, setPendingSurah] = useState(null);

  // ── Navigation history ──
  const [navHistory, setNavHistory] = useState([]);
  const [navFuture, setNavFuture] = useState([]);

  const handleNavigate = useCallback((targetTab, surahNum) => {
    setNavHistory(prev => [...prev, tab]);
    setNavFuture([]);
    if (surahNum) {
      localStorage.setItem('lastReadSurah', JSON.stringify({
        number: surahNum, name: '', ayah: 1
      }));
      setPendingSurah(surahNum);
    }
    setTab(targetTab);
  }, [setTab, tab]);

  const goBack = useCallback(() => {
    if (navHistory.length === 0) return;
    const prev = navHistory[navHistory.length - 1];
    setNavHistory(h => h.slice(0, -1));
    setNavFuture(f => [tab, ...f]);
    setTab(prev);
  }, [navHistory, tab, setTab]);

  const goForward = useCallback(() => {
    if (navFuture.length === 0) return;
    const next = navFuture[0];
    setNavFuture(f => f.slice(1));
    setNavHistory(h => [...h, tab]);
    setTab(next);
  }, [navFuture, tab, setTab]);

  // ── Global audio state (persists across tab changes) ──
  const audioRef = useRef(null);
  const [globalAudioState, setGlobalAudioState] = useState('idle');
  const [globalAudioMode, setGlobalAudioMode] = useState(null);
  const [globalSurahInfo, setGlobalSurahInfo] = useState(null); // { number, name, totalAyahs }
  const [globalAyahNum, setGlobalAyahNum] = useState(null);
  const [globalCurrentTime, setGlobalCurrentTime] = useState(0);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [globalVolume, setGlobalVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('audioVolume')) || 1; } catch { return 1; }
  });
  const [globalPlaybackRate, setGlobalPlaybackRate] = useState(1);
  const globalPlaybackRateRef = useRef(1);
  const [globalRepeatAyah, setGlobalRepeatAyah] = useState(() => {
    try {
      return localStorage.getItem('audioRepeatAyah') === 'true';
    } catch { return false; }
  });
  const globalRepeatAyahRef = useRef(globalRepeatAyah);
  const [globalLoopEnabled, setGlobalLoopEnabled] = useState(() => {
    try {
      return localStorage.getItem('audioLoopEnabled') === 'true';
    } catch { return false; }
  });
  const globalLoopEnabledRef = useRef(globalLoopEnabled);
  const [globalReciter, setGlobalReciter] = useState(() => {
    try {
      const saved = localStorage.getItem('selectedReciter');
      return saved ? (parseInt(saved, 10) || 1) : 1;
    } catch { return 1; }
  });
  const [globalReciters, setGlobalReciters] = useState(QF_RECITERS);
  const [globalAyahPlaylist, setGlobalAyahPlaylist] = useState(null);
  const [globalAutoAdvance, setGlobalAutoAdvance] = useState(false);
  const [globalActiveTrack, setGlobalActiveTrack] = useState({ surah: null, ayah: null, isPlaying: false });

  // ── Page transition animations ──
  const [transitionClass, setTransitionClass] = useState('');
  const prevTabRef = useRef(null);
  const tabOrderRef = useRef(['home', 'quran', 'salah', 'explore']);

  useEffect(() => {
    // First render - just set the reference without animation
    if (prevTabRef.current === null) {
      prevTabRef.current = tab;
      return;
    }    

    // Only animate if tab actually changed
    if (prevTabRef.current === tab) return;

    // Determine direction based on tab order
    const prevIndex = tabOrderRef.current.indexOf(prevTabRef.current);
    const currentIndex = tabOrderRef.current.indexOf(tab);
    
    // Forward: moving to a tab that comes later, OR going forward in history
    const isMovingForward = currentIndex > prevIndex;
    
    // Apply animation class
    setTransitionClass(isMovingForward ? 'transition-forward' : 'transition-back');
    
    // Remove animation class after animation completes (350ms)
    const timer = setTimeout(() => {
      setTransitionClass('');
    }, 350);

    prevTabRef.current = tab;
    
    return () => clearTimeout(timer);
  }, [tab]);

  // Load all ayah-capable reciters from one source to keep voice consistent.
  useEffect(() => {
    fetch(`${API_BASE}/api/recitations`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const recitations = data?.recitations;
        if (Array.isArray(recitations)) {
          const mapped = recitations
            .map(item => {
              const id = Number(item?.id);
              const name = String(item?.reciter_name || item?.name || '').trim();
              if (!Number.isFinite(id) || !name) return null;
              return {
                id,
                name,
                style: inferReciterStyle(name),
                source: 'dc',
              };
            })
            .filter(Boolean);

          const deduped = Array.from(new Map(mapped.map(r => [r.id, r])).values());
          if (deduped.length) {
            setGlobalReciters(deduped);
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!globalReciters.length) return;
    const exists = globalReciters.some(r => Number(r.id) === Number(globalReciter));
    if (!exists) {
      setGlobalReciter(Number(globalReciters[0].id));
    }
  }, [globalReciters, globalReciter]);

  // Save volume changes
  useEffect(() => {
    localStorage.setItem('audioVolume', String(globalVolume));
    if (audioRef.current) audioRef.current.volume = globalVolume;
  }, [globalVolume]);

  useEffect(() => {
    globalPlaybackRateRef.current = globalPlaybackRate;
    if (audioRef.current) audioRef.current.playbackRate = globalPlaybackRate;
  }, [globalPlaybackRate]);

  useEffect(() => {
    globalRepeatAyahRef.current = globalRepeatAyah;
    localStorage.setItem('audioRepeatAyah', String(globalRepeatAyah));
  }, [globalRepeatAyah]);

  useEffect(() => {
    globalLoopEnabledRef.current = globalLoopEnabled;
    localStorage.setItem('audioLoopEnabled', String(globalLoopEnabled));
  }, [globalLoopEnabled]);

  // Save reciter preference
  useEffect(() => { localStorage.setItem('selectedReciter', String(globalReciter)); }, [globalReciter]);

  const stopGlobalAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeEventListener('timeupdate', audioRef.current._onTimeUpdate);
      audioRef.current = null;
    }
    setGlobalAudioState('idle');
    setGlobalAudioMode(null);
    setGlobalSurahInfo(null);
    setGlobalAyahNum(null);
    setGlobalAyahPlaylist(null);
    setGlobalAutoAdvance(false);
    setGlobalCurrentTime(0);
    setGlobalDuration(0);
    setGlobalActiveTrack({ surah: null, ayah: null, isPlaying: false });
  }, []);

  const playGlobalAudio = useCallback((url, surahInfo, mode, ayahNum, options = {}) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeEventListener('timeupdate', audioRef.current._onTimeUpdate);
    }
    setGlobalAudioMode(mode);
    setGlobalAudioState('loading');
    setGlobalSurahInfo(surahInfo);
    setGlobalAyahNum(ayahNum || null);
    setGlobalAyahPlaylist(Array.isArray(options.ayahPlaylist) ? options.ayahPlaylist : null);
    setGlobalAutoAdvance(!!options.autoAdvance);
    setGlobalCurrentTime(0);
    setGlobalDuration(0);
    setGlobalActiveTrack({ surah: surahInfo?.number || null, ayah: ayahNum || null, isPlaying: false });

    const currentSurahNumber = Number(globalSurahInfo?.number) || null;
    const nextSurahNumber = Number(surahInfo?.number) || null;
    const isSurahChange = currentSurahNumber && nextSurahNumber && currentSurahNumber !== nextSurahNumber;
    const effectivePlaybackRate = isSurahChange ? 1 : globalPlaybackRateRef.current;

    if (isSurahChange && globalPlaybackRateRef.current !== 1) {
      setGlobalPlaybackRate(1);
    }

    const audio = new Audio(url);
    audio.volume = globalVolume;
    audio.playbackRate = effectivePlaybackRate;
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setGlobalCurrentTime(audio.currentTime);
      setGlobalDuration(audio.duration || 0);
    };
    audio._onTimeUpdate = onTimeUpdate;
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', () => setGlobalDuration(audio.duration));
    audio.addEventListener('canplaythrough', () => {
      audio.play()
        .then(() => {
          setGlobalAudioState('playing');
          setGlobalActiveTrack({ surah: surahInfo?.number || null, ayah: ayahNum || null, isPlaying: true });
        })
        .catch(() => stopGlobalAudio());
    }, { once: true });

    // Use options parameters directly instead of state variables
    const autoAdvance = !!options.autoAdvance;
    const ayahPlaylist = Array.isArray(options.ayahPlaylist) ? options.ayahPlaylist : null;
    const currentAyahNum = Number(ayahNum) || null;

    audio.onended = () => {
      const shouldRepeatAyah = !!globalRepeatAyahRef.current;
      const shouldLoopPlayback = !!globalLoopEnabledRef.current;

      if (shouldRepeatAyah && currentAyahNum) {
        audio.currentTime = 0;
        audio.play().then(() => setGlobalAudioState('playing')).catch(() => stopGlobalAudio());
        return;
      }

      const hasPlaylist = Array.isArray(ayahPlaylist) && ayahPlaylist.length > 0;
      const shouldFollowSurahSequence = hasPlaylist && (autoAdvance || shouldLoopPlayback);

      // Use the local autoAdvance and ayahPlaylist from options, not state
      if (shouldFollowSurahSequence && currentAyahNum) {
        const idx = ayahPlaylist.findIndex(item => item.ayahNumber === currentAyahNum);
        const next = idx >= 0 ? ayahPlaylist[idx + 1] : null;
        if (next?.url) {
          playGlobalAudio(next.url, surahInfo, mode, next.ayahNumber, { ayahPlaylist: ayahPlaylist, autoAdvance: true });
          return;
        }

        if (shouldLoopPlayback && ayahPlaylist[0]?.url) {
          const first = ayahPlaylist[0];
          playGlobalAudio(first.url, surahInfo, mode, first.ayahNumber, { ayahPlaylist: ayahPlaylist, autoAdvance: true });
          return;
        }

        stopGlobalAudio();
        return;
      }

      if (shouldLoopPlayback) {
        audio.currentTime = 0;
        audio.play().then(() => setGlobalAudioState('playing')).catch(() => stopGlobalAudio());
        return;
      }

      stopGlobalAudio();
    };
    audio.onerror = () => stopGlobalAudio();
    audio.load();
  }, [globalVolume, globalSurahInfo, stopGlobalAudio]);

  const toggleGlobalPlay = useCallback(() => {
    if (!audioRef.current) return;
    if (globalAudioState === 'playing') {
      audioRef.current.pause();
      setGlobalAudioState('paused');
      setGlobalActiveTrack(prev => ({ ...prev, isPlaying: false }));
    } else if (globalAudioState === 'paused') {
      audioRef.current.play();
      setGlobalAudioState('playing');
      setGlobalActiveTrack(prev => ({ ...prev, isPlaying: true }));
    }
  }, [globalAudioState]);

  const seekGlobalAudio = useCallback((e) => {
    if (!audioRef.current || !globalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * globalDuration;
  }, [globalDuration]);

  const normalizeQuranAudioUrl = useCallback((rawUrl) => {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('//')) return `https:${value}`;
    return `https://audio.qurancdn.com/${value.replace(/^\/+/, '')}`;
  }, []);

  const fetchSurahMeta = useCallback(async (surahNumber) => {
    const info = { number: surahNumber, name: `Surah ${surahNumber}`, totalAyahs: null };
    try {
      const chaptersRes = await fetch(`${API_BASE}/api/chapters`);
      if (!chaptersRes.ok) return info;
      const chaptersData = await chaptersRes.json();
      const chapter = (chaptersData?.chapters || []).find(c => Number(c.id) === Number(surahNumber));
      if (!chapter) return info;
      return {
        number: surahNumber,
        name: chapter.english_name || chapter.name_simple || info.name,
        totalAyahs: chapter.verses_count || chapter.verse_count || null,
      };
    } catch {
      return info;
    }
  }, []);

  const fetchAyahPlaylistForSurah = useCallback(async (reciterId, surahNumber) => {
    const res = await fetch(`${API_BASE}/api/audio/verse/${reciterId}/${surahNumber}`);
    if (!res.ok) return null;
    const data = await res.json();
    const files = data?.audio_files;
    if (!Array.isArray(files) || files.length === 0) return null;
    const playlist = files
      .map(f => {
        const ayahPart = String(f?.verse_key || '').split(':')[1];
        const ayahNumber = Number(ayahPart);
        if (!ayahNumber || !f?.url) return null;
        return { ayahNumber, url: normalizeQuranAudioUrl(f.url) };
      })
      .filter(Boolean)
      .sort((a, b) => a.ayahNumber - b.ayahNumber);
    if (!playlist.length) return null;
    return playlist;
  }, [normalizeQuranAudioUrl]);

  const playSpecificAyahGlobal = useCallback(async (verseRef, meta = {}) => {
    const ref = typeof verseRef === 'string'
      ? verseRef
      : String(verseRef?.verseKey || verseRef?.verse_key || '');
    const [chapterPart, ayahPart] = ref.includes(':')
      ? ref.split(':')
      : [String(meta.fallbackSurah || globalSurahInfo?.number || ''), String(verseRef?.numberInSurah || verseRef?.ayah || '')];

    const chapterNumber = Number(chapterPart);
    const ayahNumber = Number(ayahPart);
    if (!chapterNumber || !ayahNumber) return;

    if (Number(globalSurahInfo?.number) === chapterNumber && Number(globalAyahNum) === ayahNumber && globalAudioState !== 'idle') {
      toggleGlobalPlay();
      return;
    }

    try {
      const playlist = await fetchAyahPlaylistForSurah(globalReciter, chapterNumber);
      if (!playlist) return;
      const target = playlist.find(item => item.ayahNumber === ayahNumber);
      if (!target?.url) return;
      const surahInfo = {
        number: chapterNumber,
        name: meta.surahName || `Surah ${chapterNumber}`,
        totalAyahs: meta.totalAyahs || playlist.length || null,
      };
      playGlobalAudio(target.url, surahInfo, 'ayah', ayahNumber, {
        ayahPlaylist: playlist,
        autoAdvance: false,
      });
    } catch {
      // Keep existing playback state.
    }
  }, [globalReciter, globalSurahInfo, globalAyahNum, globalAudioState, toggleGlobalPlay, fetchAyahPlaylistForSurah, playGlobalAudio]);

  const playSurahTrackByNumber = useCallback(async (surahNumber) => {
    if (!surahNumber || surahNumber < 1 || surahNumber > 114) return;

    const baseSurahInfo = {
      number: surahNumber,
      name: `Surah ${surahNumber}`,
      totalAyahs: null,
    };

    try {
      const chaptersRes = await fetch(`${API_BASE}/api/chapters`);
      if (chaptersRes.ok) {
        const chaptersData = await chaptersRes.json();
        const chapter = (chaptersData?.chapters || []).find(c => Number(c.id) === surahNumber);
        if (chapter) {
          baseSurahInfo.name = chapter.english_name || chapter.name_simple || baseSurahInfo.name;
          baseSurahInfo.totalAyahs = chapter.verses_count || chapter.verse_count || null;
        }
      }
    } catch {
      // Best-effort metadata only.
    }

    try {
      const verseRes = await fetch(`${API_BASE}/api/audio/verse/${globalReciter}/${surahNumber}`);
      if (verseRes.ok) {
        const verseData = await verseRes.json();
        const files = verseData?.audio_files;
        if (Array.isArray(files) && files.length > 0) {
          const ayahPlaylist = files
            .map(f => {
              const ayahPart = String(f?.verse_key || '').split(':')[1];
              const ayahNumber = Number(ayahPart);
              if (!ayahNumber || !f?.url) return null;
              const itemUrl = normalizeQuranAudioUrl(f.url);
              return { ayahNumber, url: itemUrl };
            })
            .filter(Boolean)
            .sort((a, b) => a.ayahNumber - b.ayahNumber);

          const first = ayahPlaylist[0];
          if (first?.url) {
            playGlobalAudio(first.url, baseSurahInfo, 'surah', first.ayahNumber, { ayahPlaylist, autoAdvance: true });
            return;
          }
        }
      }
    } catch {
      // Fall through to chapter audio.
    }

    try {
      const chapterRes = await fetch(`${API_BASE}/api/audio/chapter/${globalReciter}/${surahNumber}`);
      if (!chapterRes.ok) return;
      const chapterData = await chapterRes.json();
      const audioFile = chapterData?.audio_file;
      if (!audioFile?.audio_url) return;
      const url = normalizeQuranAudioUrl(audioFile.audio_url);
      playGlobalAudio(url, baseSurahInfo, 'surah', null, { ayahPlaylist: null, autoAdvance: false });
    } catch {
      // Keep current playback state on failures.
    }
  }, [globalReciter, playGlobalAudio, normalizeQuranAudioUrl]);

  const stepGlobalAyah = useCallback(async (delta) => {
    if (!globalSurahInfo?.number) return;
    const currentSurah = Number(globalSurahInfo.number);

    let playlist = Array.isArray(globalAyahPlaylist) && globalAyahPlaylist.length
      ? globalAyahPlaylist
      : await fetchAyahPlaylistForSurah(globalReciter, currentSurah);
    if (!playlist || !playlist.length) return;

    const currentAyah = Number(globalAyahNum) || 1;
    let index = playlist.findIndex(item => item.ayahNumber === currentAyah);
    if (index < 0) index = delta > 0 ? -1 : 0;
    const targetIndex = index + delta;
    const within = playlist[targetIndex];

    if (within?.url) {
      playGlobalAudio(within.url, globalSurahInfo, globalAudioMode || 'ayah', within.ayahNumber, {
        ayahPlaylist: playlist,
        autoAdvance: globalAudioMode === 'surah',
      });
      return;
    }

    const nextSurah = currentSurah + (delta > 0 ? 1 : -1);
    if (nextSurah < 1 || nextSurah > 114) return;

    const nextPlaylist = await fetchAyahPlaylistForSurah(globalReciter, nextSurah);
    if (nextPlaylist?.length) {
      const nextSurahInfo = await fetchSurahMeta(nextSurah);
      const edgeAyah = delta > 0 ? nextPlaylist[0] : nextPlaylist[nextPlaylist.length - 1];
      playGlobalAudio(edgeAyah.url, nextSurahInfo, globalAudioMode || 'ayah', edgeAyah.ayahNumber, {
        ayahPlaylist: nextPlaylist,
        autoAdvance: globalAudioMode === 'surah',
      });
      return;
    }

    // Keep ayah transport strict: if we cannot resolve ayah audio, do not jump to chapter streams.
  }, [globalSurahInfo, globalReciter, globalAyahPlaylist, globalAyahNum, globalAudioMode, playGlobalAudio, fetchAyahPlaylistForSurah, fetchSurahMeta]);

  const globalAudioControls = {
    audioRef, audioState: globalAudioState, audioMode: globalAudioMode,
    currentAyahAudio: globalAyahNum, selectedReciter: globalReciter,
    allReciters: globalReciters, surahInfo: globalSurahInfo,
    activeTrack: globalActiveTrack,
    setSelectedReciter: (id) => { stopGlobalAudio(); setGlobalReciter(id); },
    stopAudio: stopGlobalAudio,
    playAudioUrl: playGlobalAudio,
    togglePlay: toggleGlobalPlay,
    playSpecificAyah: playSpecificAyahGlobal,
  };

  const showPlayer = globalAudioState !== 'idle' && globalSurahInfo;
  const hasSurahContext = !!globalSurahInfo?.number;
  const hasAyahReciterMatch = globalReciters.some(r => Number(r.id) === Number(globalReciter));
  const ayahMin = 1;
  const ayahMax = globalSurahInfo?.totalAyahs || null;
  const hasPlaylist = Array.isArray(globalAyahPlaylist) && globalAyahPlaylist.length > 0;
  const playlistIndex = hasPlaylist ? globalAyahPlaylist.findIndex(item => item.ayahNumber === globalAyahNum) : -1;
  const canPrevAyah = hasSurahContext && hasAyahReciterMatch && (
    (hasPlaylist && playlistIndex > 0) ||
    Number(globalSurahInfo?.number) > 1 ||
    (!hasPlaylist && Number(globalAyahNum || 1) > ayahMin)
  );
  const canNextAyah = hasSurahContext && hasAyahReciterMatch && (
    (hasPlaylist && playlistIndex >= 0 && playlistIndex < globalAyahPlaylist.length - 1) ||
    Number(globalSurahInfo?.number) < 114 ||
    (!hasPlaylist && (!ayahMax || Number(globalAyahNum || 1) < ayahMax))
  );

  // ── Global search overlay ──
  const [showSearch, setShowSearch] = useState(false);

  const handleSearchNavigate = useCallback((surahNum) => {
    handleNavigate('quran', surahNum);
  }, [handleNavigate]);

  // ── Reading timer (tracks minutes spent on Quran tab) ──
  const timerRef = useRef(null);
  useEffect(() => {
    clearInterval(timerRef.current);
    if (tab === 'quran') {
      timerRef.current = setInterval(() => {
        recordReadingSeconds(1);
      }, 1000); // log every second for live mm:ss stats
    }
    return () => clearInterval(timerRef.current);
  }, [tab]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

      // Escape: close panels
      if (e.key === 'Escape') {
        if (showSettings) { setShowSettings(false); return; }
        if (showSearch) { setShowSearch(false); return; }
        return;
      }

      if (inInput) return;

      // Ctrl+F or /: open search
      if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      // Space: play / pause
      if (e.key === ' ' && globalAudioState !== 'idle') {
        e.preventDefault();
        toggleGlobalPlay();
        return;
      }
      // F: fullscreen shortcut handled in Quran via event
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSettings, showSearch, globalAudioState, toggleGlobalPlay, setShowSettings]);

  const normalizedCustomAccent = normalizeHexColor(settings.customAccent);
  const hasCustomTheme = Boolean(normalizedCustomAccent);
  const resolvedTheme = settings.theme;
  const appStyle = buildCustomThemeStyle(normalizedCustomAccent, resolvedTheme === 'light' ? 'light' : 'dark') || {};

  const isLightMode = resolvedTheme === 'light';
  const toggleThemeMode = () => {
    updateSetting('theme', isLightMode ? 'dark-navy' : 'light');
  };

  return (
    <div
      className={`app theme-${resolvedTheme} ${showPlayer ? 'has-player' : ''}`}
      data-custom-theme={hasCustomTheme ? 'true' : 'false'}
      style={appStyle}
    >
      <header className="app-chrome" aria-label="Top controls">
        <div className="app-chrome-group app-chrome-group-left">
          <div className="app-corner-logo" title="DeenCore">
            <img src={deenCoreIcon} alt="" className="app-corner-logo-img" aria-hidden="true" />
            <span className="app-corner-wordmark">
              <span className="app-corner-wordmark-deen">Deen</span><span className="app-corner-wordmark-core">Core</span>
            </span>
          </div>
          <div className="nav-history-btns">
            <button className="nav-hist-btn" onClick={goBack} disabled={navHistory.length === 0} title="Go Back">
              <IconArrowLeft />
            </button>
            <button className="nav-hist-btn" onClick={goForward} disabled={navFuture.length === 0} title="Go Forward">
              <IconArrowRight />
            </button>
          </div>
        </div>

        <nav className="top-nav" role="navigation" aria-label="Main navigation">
          <button className={tab === "home" ? "active" : ""} onClick={() => handleNavigate("home")} aria-current={tab === "home" ? "page" : undefined} title="Home" aria-label="Home">
            <IconHome />
          </button>
          <button className={tab === "quran" ? "active" : ""} onClick={() => handleNavigate("quran")} aria-current={tab === "quran" ? "page" : undefined} title="Quran" aria-label="Quran">
            <IconQuran />
          </button>
          <button className={tab === "salah" ? "active" : ""} onClick={() => handleNavigate("salah")} aria-current={tab === "salah" ? "page" : undefined} title="Salah" aria-label="Salah">
            <IconPrayer />
          </button>
          <button className={tab === "explore" ? "active" : ""} onClick={() => handleNavigate("explore")} aria-current={tab === "explore" ? "page" : undefined} title="Explore" aria-label="Explore">
            <IconExplore />
          </button>
        </nav>

        <div className="app-chrome-group app-chrome-group-right" aria-label="Account and settings">
          <UserBadge />
          <button
            className="global-settings-btn theme-toggle-btn"
            onClick={toggleThemeMode}
            title={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            aria-label={isLightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {isLightMode ? <IconMoon /> : <IconSun />}
          </button>
          <button className="global-settings-btn" onClick={() => setShowSettings(true)} title="Settings">
            <IconGear />
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel />}
      {showSearch && <QuranSearch onNavigate={handleSearchNavigate} onClose={() => setShowSearch(false)} />}

      <div className={`content ${transitionClass}`}>
        {tab === "home" && <Home onNavigate={handleNavigate} />}
        {tab === "quran" && <Quran key={pendingSurah} audioControls={globalAudioControls} onOpenSearch={() => setShowSearch(true)} />}
        {tab === "salah" && <Salah />}
        {tab === "explore" && <Explore onNavigate={handleNavigate} />}
      </div>

      {/* Global mini audio player */}
      {showPlayer && (
        <GlobalAudioPlayer
          audio={{
            currentTime: globalCurrentTime,
            duration: globalDuration,
            playing: globalAudioState === 'playing',
            loading: globalAudioState === 'loading',
            surahName: globalSurahInfo?.name,
            surahNumber: globalSurahInfo?.number,
            ayahInfo: globalAyahNum ? `Ayah ${globalAyahNum}` : null,
            volume: globalVolume,
            speed: globalPlaybackRate,
            repeatAyah: globalRepeatAyah,
            loopEnabled: globalLoopEnabled,
            canPrevAyah,
            canNextAyah,
            onTogglePlay: toggleGlobalPlay,
            onSeek: seekGlobalAudio,
            onVolumeChange: setGlobalVolume,
            onSpeedChange: setGlobalPlaybackRate,
            onToggleRepeatAyah: () => setGlobalRepeatAyah(prev => !prev),
            onToggleLoop: () => setGlobalLoopEnabled(prev => !prev),
            onPrevAyah: () => stepGlobalAyah(-1),
            onNextAyah: () => stepGlobalAyah(1),
          }}
          onClose={stopGlobalAudio}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// AUTH PAGE — Sign In / Sign Up / Guest / Social
// ═══════════════════════════════════════════════════════════
function SocialLoginModal({ provider, onConfirm, onClose }) {
  const accounts = SOCIAL_ACCOUNTS[provider] || [];
  const label = SOCIAL_LABELS[provider];
  const [loading, setLoading] = useState(false);

  const choose = (acc) => {
    setLoading(true);
    setTimeout(() => { onConfirm(provider, acc.email, acc.name); }, 900);
  };

  return (
    <div className="social-modal-overlay" onClick={onClose}>
      <div className="social-modal" onClick={e => e.stopPropagation()}>
        {loading ? (
          <div className="social-modal-loading">
            <div className="auth-spinner" />
            <p>Signing in with {label}…</p>
          </div>
        ) : (
          <>
            <div className="social-modal-header">
              <span className="social-modal-title">Choose a {label} account</span>
              <button className="social-modal-close" onClick={onClose}>✕</button>
            </div>
            <p className="social-modal-note">Simulated {label} OAuth — select an account to continue</p>
            {accounts.map(acc => (
              <button key={acc.email} className="social-modal-account" onClick={() => choose(acc)}>
                <span className="social-modal-avatar">{acc.avatar || label[0]}</span>
                <span className="social-modal-info">
                  <span className="social-modal-name">{acc.name}</span>
                  <span className="social-modal-email">{acc.email}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function AuthPage({ onLogin }) {
  const [entryMode, setEntryMode] = useState('guest');
  const [accountMode, setAccountMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialModal, setSocialModal] = useState(null);

  const submit = () => {
    setError('');
    if (!email.trim()) return setError('Email is required.');
    if (!password) return setError('Password is required.');
    if (accountMode === 'signup' && !name.trim()) return setError('Name is required.');
    setLoading(true);
    setTimeout(() => {
      const result = accountMode === 'signup'
        ? dbSignUp(name.trim(), email.trim(), password)
        : dbSignIn(email.trim(), password);
      setLoading(false);
      if (result.error) setError(result.error);
      else onLogin(result.user);
    }, 400);
  };

  const handleGuest = () => {
    const { user } = dbGuestLogin();
    onLogin(user);
  };

  const handleSocial = (provider) => setSocialModal(provider);

  const confirmSocial = (provider, email, name) => {
    const { user } = dbSocialLogin(provider, email, name);
    setSocialModal(null);
    onLogin(user);
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-side-panel">
          <div className="auth-side-orb auth-side-orb-a" />
          <div className="auth-side-orb auth-side-orb-b" />
          <div className="auth-logo-wrap">
            <img src={deenCoreIcon} alt="DeenCore" className="auth-logo-icon" />
            <span className="auth-logo-text"><span className="auth-logo-deen">Deen</span>Core</span>
          </div>
          <p className="auth-side-kicker">Focused reading, reflection, and audio in one place.</p>
          <h1 className="auth-side-title">Welcome back to DeenCore.</h1>
          <div className="auth-side-features">
            <div className="auth-side-feature"><span>114</span> Surahs with search and translation</div>
            <div className="auth-side-feature"><span>Tailored</span> Experience customized your way</div>
            <div className="auth-side-feature"><span>Local</span> Progress, streaks, and bookmarks</div>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-card-header">
            <h2 className="auth-heading">
              {entryMode === 'guest' ? 'Jump right in' : (accountMode === 'signin' ? 'Welcome back' : 'Create your account')}
            </h2>
            <p className="auth-subheading">
              {entryMode === 'guest'
                ? 'No account needed. Start reading immediately.'
                : (accountMode === 'signin' ? 'Pick up exactly where you left off.' : 'Save bookmarks, streaks, and reading progress locally.')}
            </p>
          </div>

          <div className="auth-tabs">
            <button
              className={`auth-tab guest-cta ${entryMode === 'guest' ? 'active' : ''}`}
              onClick={() => { setEntryMode('guest'); setError(''); }}
            >
              Skip Sign-In
            </button>
            <button
              className={`auth-tab ${entryMode === 'account' ? 'active' : ''}`}
              onClick={() => { setEntryMode('account'); setError(''); }}
            >
              Sign In
            </button>
          </div>

          {entryMode === 'guest' ? (
            <div className="auth-quick-continue">
              <button className="auth-guest-btn auth-guest-btn-primary" onClick={handleGuest}>
                Continue Without Sign-In
              </button>
              <p className="auth-disclaimer">Fastest option. Guest mode stays local to this device.</p>
            </div>
          ) : (
            <>
              <div className="auth-social-grid">
                {['google', 'microsoft', 'apple', 'github'].map(p => (
                  <button key={p} className={`auth-social-btn auth-social-${p}`} onClick={() => handleSocial(p)}>
                    <SocialIcon provider={p} />
                    <span>{SOCIAL_LABELS[p]}</span>
                  </button>
                ))}
              </div>

              <div className="auth-divider"><span>or continue with email</span></div>

              <div className="auth-form">
                {accountMode === 'signup' && (
                  <div className="auth-field">
                    <label>Full Name</label>
                    <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submit()} className="auth-input" />
                  </div>
                )}
                <div className="auth-field">
                  <label>Email</label>
                  <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()} className="auth-input" autoComplete="email" />
                </div>
                <div className="auth-field">
                  <label>Password</label>
                  <div className="auth-pass-wrap">
                    <input type={showPass ? 'text' : 'password'} placeholder="••••••••" value={password}
                      onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
                      className="auth-input" autoComplete={accountMode === 'signin' ? 'current-password' : 'new-password'} />
                    <button className="auth-pass-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                      {showPass ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                <button className="auth-submit" onClick={submit} disabled={loading}>
                  {loading ? <span className="auth-spinner-sm" /> : (accountMode === 'signin' ? 'Sign In' : 'Create Account')}
                </button>

                <p className="auth-inline-switch">
                  {accountMode === 'signin' ? 'New here?' : 'Already have an account?'}
                  <button
                    type="button"
                    className="auth-inline-switch-btn"
                    onClick={() => {
                      setAccountMode(accountMode === 'signin' ? 'signup' : 'signin');
                      setError('');
                    }}
                  >
                    {accountMode === 'signin' ? 'Create account' : 'Sign in'}
                  </button>
                </p>
              </div>

              <div className="auth-divider-light" />

              <button className="auth-guest-btn" onClick={() => { setEntryMode('guest'); setError(''); }}>
                Skip Sign-In Instead
              </button>

              <p className="auth-disclaimer">Guest mode stays local to this device.</p>
            </>
          )}
        </div>
      </div>

      {socialModal && (
        <SocialLoginModal
          provider={socialModal}
          onConfirm={confirmSocial}
          onClose={() => setSocialModal(null)}
        />
      )}
    </div>
  );
}

function SocialIcon({ provider }) {
  if (provider === 'google') return (
    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
  );
  if (provider === 'microsoft') return (
    <svg width="18" height="18" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
  );
  if (provider === 'apple') return (
    <svg width="18" height="18" viewBox="0 0 814 1000" fill="currentColor"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663.5 0 541.4c0-194.3 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>
  );
  if (provider === 'github') return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
  );
  return null;
}

// ─── User Badge (avatar + sign-out dropdown) ───────────────
function UserBadge() {
  const { currentUser, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const initials = currentUser?.name
    ? currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const isGuest = currentUser?.provider === 'guest';

  const providerBadge = { google: 'G', microsoft: 'M', apple: '', github: '' }[currentUser?.provider] || null;

  return (
    <div className="user-badge" ref={ref}>
      <button className="user-avatar-btn" onClick={() => setOpen(v => !v)} title={currentUser?.name || 'Account'}>
        <span className="user-avatar">{initials}</span>
        {providerBadge && <span className="user-provider-dot">{providerBadge}</span>}
      </button>
      {open && (
        <div className="user-dropdown">
          <div className="user-dropdown-info">
            <span className="user-dropdown-name">{isGuest ? 'Guest User' : currentUser?.name}</span>
            {currentUser?.email && <span className="user-dropdown-email">{currentUser.email}</span>}
            <span className="user-dropdown-provider">{currentUser?.provider}</span>
          </div>
          <button className="user-dropdown-signout" onClick={signOut}>Sign Out</button>
        </div>
      )}
    </div>
  );
}

// ─── Auth Gate — wraps entire app ──────────────────────────
function AuthGate({ children }) {
  const [currentUser, setCurrentUser] = useState(() => loadSession());

  const signOut = () => { clearSession(); setCurrentUser(null); };

  if (!currentUser) {
    return <AuthPage onLogin={user => setCurrentUser(user)} />;
  }

  return (
    <AuthContext.Provider value={{ currentUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export default function App() {
  const [tab, setTab] = useState(() => {
    const hasVisited = localStorage.getItem('hasVisited');
    if (!hasVisited) {
      // First-time visitor → always start on home
      return 'home';
    }
    // Returning user → restore last active tab
    return localStorage.getItem('activeTab') || 'home';
  });

  useEffect(() => {
    localStorage.setItem('activeTab', tab);
    localStorage.setItem('hasVisited', 'true');
  }, [tab]);

  return (
    <AuthGate>
      <SettingsProvider>
        <AppShell tab={tab} setTab={setTab} />
      </SettingsProvider>
    </AuthGate>
  );
}

