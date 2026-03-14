import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const BACKEND_URL = 'https://aerobrowser-backend-1002656620058.us-central1.run.app';
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
const SIDEBAR_WIDTH = 340;
const TAG_LIMIT = 60; // max interactive elements to tag per screenshot

// Global element registry for the current screenshot's tags
let lastTagMap: Map<number, HTMLElement> = new Map();
let tagCounter = 0;

type LogEntry = { time: string; msg: string; type: 'info' | 'error' | 'success' };
type HistoryMsg = { role: 'user' | 'assistant' | 'action'; text: string; streaming?: boolean };
type TaskPlan = { goal: string; steps: string[]; currentStep: number; completed: boolean; summary?: string };

// Web Speech API types
declare global {
  interface Window { webkitSpeechRecognition: any; SpeechRecognition: any; }
}

const LANGUAGES = [
  { code: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it-IT', label: 'Italiano', flag: '🇮🇹' },
  { code: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { code: 'ko-KR', label: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
] as const;

const ts = () => new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Visual feedback for actions ---
function showClickIndicator(x: number, y: number) {
  const ripple = document.createElement('div');
  ripple.style.cssText = `
    position:fixed; left:${x}px; top:${y}px; width:44px; height:44px;
    border-radius:50%; border:3px solid #8B5CF6; background:rgba(139,92,246,0.15);
    pointer-events:none; z-index:2147483646;
    animation: aero-click-ripple 0.6s ease-out forwards;
  `;
  const dot = document.createElement('div');
  dot.style.cssText = `
    position:fixed; left:${x}px; top:${y}px; width:14px; height:14px;
    margin:-7px 0 0 -7px; border-radius:50%; background:#8B5CF6;
    pointer-events:none; z-index:2147483646;
    animation: aero-cursor-pulse 0.6s ease-in-out;
  `;
  document.body.appendChild(ripple);
  document.body.appendChild(dot);
  setTimeout(() => { ripple.remove(); dot.remove(); }, 700);
}

function showActionToast(text: string) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:rgba(139,92,246,0.92); color:#fff; padding:8px 20px;
    border-radius:999px; font:600 13px/1.4 system-ui,sans-serif;
    pointer-events:none; z-index:2147483646; white-space:nowrap;
    box-shadow:0 4px 24px rgba(139,92,246,0.4);
    animation: aero-toast-in 0.3s ease-out;
  `;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// --- Set-of-Marks (SoM) tagging system ---
// Scans the page for interactive elements, draws numbered circles on the canvas,
// and returns a registry mapping tag IDs → HTMLElement.
function isInteractiveAndVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 6 || rect.height < 6) return false;
  if (rect.right < 0 || rect.bottom < 0) return false;
  // Exclude elements that are inside or behind the sidebar
  if (rect.left > window.innerWidth - SIDEBAR_WIDTH - 4) return false;
  if (rect.top > window.innerHeight) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) return false;
  return true;
}

function getElementLabel(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label') || '';
  if (aria) return aria.slice(0, 50);
  const ph = (el as HTMLInputElement).placeholder || '';
  if (ph) return ph.slice(0, 50);
  const txt = (el.textContent || '').trim();
  if (txt) return txt.slice(0, 50);
  const alt = el.getAttribute('alt') || '';
  if (alt) return alt.slice(0, 50);
  return el.tagName.toLowerCase();
}

type TagEntry = { id: number; el: HTMLElement; cx: number; cy: number; label: string; tag: string };

function collectInteractiveElements(): TagEntry[] {
  const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="radio"],[contenteditable="true"]';
  const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const entries: TagEntry[] = [];
  tagCounter = 0;
  lastTagMap = new Map();
  for (const el of nodes) {
    if (!isInteractiveAndVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const id = ++tagCounter;
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    lastTagMap.set(id, el);
    entries.push({ id, el, cx, cy, label: getElementLabel(el), tag: el.tagName });
    if (entries.length >= TAG_LIMIT) break;
  }
  return entries;
}

// Draw numbered tag circles onto an existing canvas context
function drawTagsOnCanvas(ctx: CanvasRenderingContext2D, entries: TagEntry[]) {
  for (const { id, cx, cy } of entries) {
    const label = String(id);
    const r = 10;
    // Background circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#EF4444';
    ctx.fill();
    // Number text
    ctx.font = `bold ${r + 2}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }
}

// --- Browser action executors ---
function getClickableParent(el: HTMLElement | null): HTMLElement | null {
  let curr = el;
  const isClickable = (e: HTMLElement) => {
    const s = window.getComputedStyle(e);
    return ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'LABEL'].includes(e.tagName) ||
           e.getAttribute('role') === 'button' ||
           e.onclick != null ||
           s.cursor === 'pointer';
  };
  while (curr && curr !== document.body) {
    if (isClickable(curr)) return curr;
    curr = curr.parentElement;
  }
  return null;
}

async function executeClick(x: number, y: number, description: string) {
  const maxX = Math.max(0, window.innerWidth - SIDEBAR_WIDTH - 1);
  const safeX = Math.min(Math.max(0, x), maxX);
  const safeY = Math.min(Math.max(0, y), window.innerHeight - 1);
  showClickIndicator(safeX, safeY);
  showActionToast(`Clicking: ${description}`);
  await delay(300);

  // 1. Initial hit test
  let el = document.elementFromPoint(safeX, safeY) as HTMLElement | null;
  let target = getClickableParent(el);

  // 2. If no clickable element found, search nearby (radius 20px) to compensate for coordinate drift
  if (!target) {
    const offsets = [[0, 10], [0, -10], [10, 0], [-10, 0], [12, 12], [-12, -12], [12, -12], [-12, 12]];
    for (const [dx, dy] of offsets) {
      const neighbor = document.elementFromPoint(safeX + dx, safeY + dy) as HTMLElement | null;
      const candidate = getClickableParent(neighbor);
      if (candidate) {
        target = candidate;
        // Show secondary indicator for the snap
        showClickIndicator(safeX + dx, safeY + dy); 
        break;
      }
    }
  }

  // Fallback to the original element if still nothing specific found
  if (!target && el) target = el;

  if (target) {
    // Focus if input-like to prepare for typing
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
      (target as HTMLElement).focus();
    }
    
    // Create high-quality mouse events
    const opts = { 
        view: window, 
        bubbles: true, 
        cancelable: true, 
      clientX: safeX, 
      clientY: safeY,
      screenX: safeX + window.screenX,
      screenY: safeY + window.screenY
    };
    
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
    
    let text = target.textContent || (target as any).value || '';
    return { success: true, tag: target.tagName, text: text.slice(0, 40).trim() };
  }
  return { success: false, error: 'No element found at coordinates' };
}

function executeType(text: string) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return { success: false, error: 'No focused element' };
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const newVal = (el.value || '') + text;
    if (setter) setter.call(el, newVal);
    else el.value = newVal;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    showActionToast(`Typing: "${text.slice(0, 30)}"`);
    return { success: true, typed: text };
  }
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    showActionToast(`Typing: "${text.slice(0, 30)}"`);
    return { success: true, typed: text };
  }
  return { success: false, error: `Element ${tag} is not editable` };
}

function executeKeyPress(key: string) {
  const el = (document.activeElement || document.body) as HTMLElement;
  const opts: KeyboardEventInit = { key, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  if (key === 'Enter' && (el.tagName === 'INPUT')) {
    const form = (el as HTMLInputElement).form;
    if (form) form.requestSubmit?.();
  }
  showActionToast(`Key: ${key}`);
  return { success: true, key };
}

function executeScroll(direction: string, amount: number = 400) {
  window.scrollBy({ top: direction === 'down' ? amount : -amount, behavior: 'smooth' });
  showActionToast(`Scroll ${direction}`);
  return { success: true, direction, amount };
}

function executeGoBack() {
  window.history.back();
  showActionToast('Going back');
  return { success: true };
}

async function executeAction(name: string, args: Record<string, any>) {
  switch (name) {
    case 'type_text': return executeType(args.text);
    case 'press_key': return executeKeyPress(args.key);
    case 'scroll_page': return executeScroll(args.direction, args.amount || 400);
    case 'go_back': return executeGoBack();
    case 'click_tag': {
      const id = Number(args.tag_id);
      const el = lastTagMap.get(id);
      if (!el) return { success: false, error: `Tag #${id} not found — page may have changed, request fresh screenshot.` };
      const rect = el.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      return executeClick(cx, cy, args.description || `tag #${id}`);
    }
    case 'type_tag': {
      const id = Number(args.tag_id);
      const el = lastTagMap.get(id);
      if (!el) return { success: false, error: `Tag #${id} not found.` };
      el.focus();
      return executeType(args.text);
    }
    // Legacy fallback (still useful for scrolled-off items Gemini sees by coords)
    case 'click_element': return executeClick(args.x, args.y, args.description || '');
    default: return { success: false, error: `Unknown action: ${name}` };
  }
}

const App = () => {
  // --- Refs ---
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const fromStorageRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsEnabledRef = useRef(true);
  const languageRef = useRef('en-US');
  const sessionIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  // WebSocket & Speech refs
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendScreenshotRef = useRef<() => Promise<void>>(async () => {});

  // --- State ---
  const [history, setHistory] = useState<HistoryMsg[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [manualPrompt, setManualPrompt] = useState('');
  const [speechStatus, setSpeechStatus] = useState<string>('Inactive');
  const [showLogs, setShowLogs] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [language, setLanguage] = useState('en-US');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [taskPlan, setTaskPlan] = useState<TaskPlan | null>(null);
  const [lastTaggedScreenshot, setLastTaggedScreenshot] = useState<string | null>(null);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-50), { time: ts(), msg, type }]);
  }, []);

  // Keep refs in sync
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);
  useEffect(() => { languageRef.current = language; }, [language]);

  // Load language from storage on mount
  useEffect(() => {
    chrome.storage.local.get('aero_language', (data) => {
      if (data.aero_language && typeof data.aero_language === 'string') {
        setLanguage(data.aero_language);
        languageRef.current = data.aero_language;
      }
    });
  }, []);

  // ---- Cross-tab state persistence ----
  useEffect(() => {
    chrome.storage.local.get('aero_state', (data) => {
      const s = data.aero_state as { history?: HistoryMsg[]; logs?: LogEntry[] } | undefined;
      if (!s) return;
      fromStorageRef.current = true;
      if (s.history?.length) setHistory(s.history);
      if (s.logs?.length) setLogs(s.logs);
      requestAnimationFrame(() => { fromStorageRef.current = false; });
    });
  }, []);

  useEffect(() => {
    if (fromStorageRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      chrome.storage.local.set({ aero_state: { history, logs } });
    }, 300);
  }, [history, logs]);

  useEffect(() => {
    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !changes.aero_state) return;
      const s = changes.aero_state.newValue as { history?: HistoryMsg[]; logs?: LogEntry[] } | undefined;
      if (!s) return;
      fromStorageRef.current = true;
      if (s.history) setHistory(s.history);
      if (s.logs) setLogs(s.logs);
      requestAnimationFrame(() => { fromStorageRef.current = false; });
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  // Push page content to make room for sidebar
  useEffect(() => {
    const html = document.documentElement;
    html.style.marginRight = `${SIDEBAR_WIDTH}px`;
    return () => { html.style.marginRight = '0px'; };
  }, []);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, currentAction]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);



  // ---- Navigator session (WebSocket + Web Speech) ----
  const cleanupLive = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch (_) {} wsRef.current = null; }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (_) {} recognitionRef.current = null; }
    if (screenshotIntervalRef.current) { clearInterval(screenshotIntervalRef.current); screenshotIntervalRef.current = null; }
    window.speechSynthesis.cancel();
  }, []);

  // Speak text via Web Speech Synthesis
  const speakText = useCallback((text: string) => {
    if (!ttsEnabledRef.current || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = languageRef.current;
    utt.rate = 1.1;
    window.speechSynthesis.speak(utt);
  }, []);

  // Capture screenshot, draw SoM tags on it, and send via WebSocket
  const captureAndSendScreenshot = useCallback(async (ws: WebSocket): Promise<{ data: string; mime_type: string } | null> => {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' });
      if (!resp?.success || ws.readyState !== WebSocket.OPEN) return null;
      const blob = await (await fetch(resp.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pageWidth = Math.max(1, vw - SIDEBAR_WIDTH);
      const canvas = document.createElement('canvas');
      canvas.width = pageWidth;
      canvas.height = vh;
      const ctx = canvas.getContext('2d')!;
      // Draw cropped page (no sidebar)
      ctx.drawImage(bitmap, 0, 0, vw, vh, 0, 0, pageWidth, vh);
      bitmap.close();
      // Collect interactive elements and stamp numbered tags
      const tagEntries = collectInteractiveElements();
      drawTagsOnCanvas(ctx, tagEntries);
      const base64 = canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
      const screenshotPayload = { data: base64, mime_type: 'image/jpeg' };
      // Build compact tag manifest for the backend
      const tag_map = tagEntries.map(e => ({ id: e.id, tag: e.tag, label: e.label }));
      ws.send(JSON.stringify({ type: 'screenshot', ...screenshotPayload, tag_map }));
      // Store for debug preview in Logs panel
      setLastTaggedScreenshot(`data:image/jpeg;base64,${base64}`);
      return screenshotPayload;
    } catch (_) { return null; }
  }, []);

  // Handle tool calls from Gemini (multiple calls in one batch)
  const handleToolCalls = useCallback(async (calls: Array<{ name: string; args: Record<string, any> }>, ws: WebSocket) => {
    const responses: Array<{ name: string; result: any }> = [];

    for (const call of calls) {
      const { name, args } = call;
      addLog(`🔧 ${name}(${JSON.stringify(args)})`, 'info');
      setCurrentAction(`${name}: ${args.description || args.text || args.key || args.direction || ''}`);
      setHistory(prev => [...prev, {
        role: 'action' as const,
        text: `🔧 ${
          name === 'click_tag' ? `Click tag #${args.tag_id} — ${args.description}` :
          name === 'type_tag' ? `Type "${args.text}" into tag #${args.tag_id}` :
          name === 'click_element' ? `Click "${args.description}" at (${args.x}, ${args.y})` :
          name === 'type_text' ? `Type "${args.text}"` :
          name === 'press_key' ? `Press ${args.key}` :
          name === 'scroll_page' ? `Scroll ${args.direction}` :
          name === 'go_back' ? 'Go back' : name}`,
      }]);

      const result = await executeAction(name, args);
      addLog(`✅ ${JSON.stringify(result)}`, 'success');
      responses.push({ name, result });
    }

    setCurrentAction(null);

    // Wait for page to settle, take post-action tagged screenshot, and send everything
    await delay(700);
    let screenshot: { data: string; mime_type: string } | null = null;
    let tag_map: Array<{id:number; tag:string; label:string}> = [];
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CAPTURE_TAB' });
      if (resp?.success) {
        const blob = await (await fetch(resp.dataUrl)).blob();
        const bitmap = await createImageBitmap(blob);
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pageWidth = Math.max(1, vw - SIDEBAR_WIDTH);
        const canvas = document.createElement('canvas');
        canvas.width = pageWidth;
        canvas.height = vh;
        const ctx2 = canvas.getContext('2d')!;
        ctx2.drawImage(bitmap, 0, 0, vw, vh, 0, 0, pageWidth, vh);
        bitmap.close();
        // Re-tag the new page state
        const tagEntries = collectInteractiveElements();
        drawTagsOnCanvas(ctx2, tagEntries);
        tag_map = tagEntries.map(e => ({ id: e.id, tag: e.tag, label: e.label }));
        screenshot = { data: canvas.toDataURL('image/jpeg', 0.72).split(',')[1], mime_type: 'image/jpeg' };
      }
    } catch (_) {}

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'tool_responses',
        responses,
        screenshot,
        tag_map,
      }));
    }
  }, [addLog]);

  const startLive = useCallback(async () => {
    if (wsRef.current) return;

    const lang = languageRef.current;
    addLog(`Connecting Navigator (${lang})...`);
    setLiveActive(true);
    setSpeechStatus('🟡 Connecting...');

    // Request mic permission first (SpeechRecognition won't prompt on its own)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop tracks immediately — we only needed the permission grant
      stream.getTracks().forEach(t => t.stop());
      addLog('Microphone permission granted', 'success');
    } catch (err: any) {
      addLog(`Mic permission denied: ${err.message}`, 'error');
      setSpeechStatus('❌ Mic denied');
      setLiveActive(false);
      return;
    }

    const ws = new WebSocket(
      `${WS_URL}/ws/navigate?language=${encodeURIComponent(lang)}&session_id=${encodeURIComponent(sessionIdRef.current)}&page_url=${encodeURIComponent(window.location.href)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      addLog('WebSocket connected', 'success');
      setLiveConnected(true);
      setSpeechStatus('🟢 Listening...');

      // --- Periodic screenshots ---
      const sendScreenshot = async () => { await captureAndSendScreenshot(ws); };
      sendScreenshotRef.current = sendScreenshot;
      sendScreenshot();
      screenshotIntervalRef.current = setInterval(sendScreenshot, 4000);

      // --- Web Speech Recognition (voice → text) ---
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = lang;
        recognitionRef.current = recognition;

        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
              if (transcript && ws.readyState === WebSocket.OPEN) {
                setHistory(prev => [...prev, { role: 'user', text: transcript }]);
                addLog(`Voice: "${transcript}"`);
                setSpeechStatus('🟢 Processing...');
                sendScreenshot().then(() => {
                  ws.send(JSON.stringify({ type: 'text', text: transcript }));
                });
              }
            } else if (transcript) {
              // Show interim (partial) transcription as status
              setSpeechStatus(`🎤 ${transcript}`);
            }
          }
        };

        recognition.onerror = (event: any) => {
          addLog(`Speech: ${event.error}`, event.error === 'no-speech' ? 'info' : 'error');
          if (event.error === 'not-allowed') {
            setSpeechStatus('❌ Mic not allowed');
          }
        };

        recognition.onend = () => {
          // Auto-restart if still active
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try { recognition.start(); } catch (_) {}
          }
        };

        try {
          recognition.start();
          addLog('Voice recognition active', 'success');
        } catch (err: any) {
          addLog(`Speech recognition failed: ${err.message}`, 'error');
        }
      } else {
        addLog('Speech Recognition not available in this browser', 'error');
      }
    };

    // --- Handle messages from backend ---
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'tool_calls') {
          // Update plan step if active
          setTaskPlan(prev => prev && !prev.completed ? { ...prev, currentStep: prev.currentStep + 1 } : prev);
          handleToolCalls(msg.calls, ws);
        } else if (msg.type === 'plan') {
          setTaskPlan({
            goal: msg.goal,
            steps: msg.steps,
            currentStep: msg.current_step,
            completed: false,
          });
          addLog(`📋 Plan: ${msg.goal} (${msg.steps.length} steps)`, 'success');
        } else if (msg.type === 'task_complete') {
          setTaskPlan(prev => prev ? { ...prev, completed: true, summary: msg.summary } : null);
          setHistory(prev => [...prev, { role: 'assistant', text: `✅ ${msg.summary}` }]);
          speakText(msg.summary);
          addLog(`✅ Task complete: ${msg.summary}`, 'success');
        } else if (msg.type === 'text' && msg.text) {
          setHistory(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + msg.text }];
            }
            return [...prev, { role: 'assistant', text: msg.text, streaming: true }];
          });
          speakText(msg.text);
          setSpeechStatus('🟢 Speaking...');
        } else if (msg.type === 'turn_complete') {
          setHistory(prev => {
            const last = prev[prev.length - 1];
            if (last && last.streaming) {
              return [...prev.slice(0, -1), { ...last, streaming: false }];
            }
            return prev;
          });
          setSpeechStatus('🟢 Listening...');
          addLog('Turn complete', 'success');
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      addLog('WebSocket error', 'error');
      setSpeechStatus('❌ Connection error');
    };

    ws.onclose = () => {
      addLog('WebSocket closed');
      setLiveConnected(false);
      setLiveActive(false);
      setSpeechStatus('Inactive');
      cleanupLive();
    };
  }, [addLog, cleanupLive, captureAndSendScreenshot, handleToolCalls, speakText]);

  const stopLive = useCallback(() => {
    cleanupLive();
    setLiveActive(false);
    setLiveConnected(false);
    setSpeechStatus('Inactive');
    setTaskPlan(null);
    addLog('Navigator stopped');
  }, [addLog, cleanupLive]);

  // Mute/unmute TTS
  useEffect(() => {
    if (!ttsEnabled) window.speechSynthesis.cancel();
  }, [ttsEnabled]);

  // ---- Manual text input ----
  const pendingPromptRef = useRef<string | null>(null);

  // Flush pending prompt once WebSocket connects
  useEffect(() => {
    if (liveConnected && pendingPromptRef.current) {
      const prompt = pendingPromptRef.current;
      pendingPromptRef.current = null;
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendScreenshotRef.current().then(() => {
            wsRef.current?.send(JSON.stringify({ type: 'text', text: prompt }));
          });
          addLog(`Text sent: "${prompt}"`);
        }
      }, 500);
    }
  }, [liveConnected, addLog]);

  const handleManualSend = () => {
    const prompt = manualPrompt.trim();
    if (!prompt) return;
    setManualPrompt('');
    setHistory(prev => [...prev, { role: 'user', text: prompt }]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Already connected — send immediately
      sendScreenshotRef.current().then(() => {
        wsRef.current?.send(JSON.stringify({ type: 'text', text: prompt }));
      });
      addLog(`Text sent: "${prompt}"`);
    } else {
      // Auto-start navigator and queue the message
      pendingPromptRef.current = prompt;
      addLog('Auto-starting navigator...');
      startLive();
    }
  };

  // ---- JSX ----
  return (
      <>
      <div
        className="fixed top-0 right-0 h-full z-[2147483647] pointer-events-auto"
        style={{ width: '340px' }}
      >
        <div className="w-full h-full bg-gray-950/95 backdrop-blur-xl border-l border-white/10 flex flex-col shadow-2xl">
          {/* Header */}
          <div className="p-3 border-b border-white/10 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-white text-sm font-bold tracking-wide">AeroBrowser</h2>
              <p className="text-purple-400 text-[10px] font-medium tracking-widest">UI NAVIGATOR</p>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowLangMenu(v => !v)}
                className="text-white/50 hover:text-white/80 transition-colors cursor-pointer text-sm px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30"
                title="Language"
              >
                {LANGUAGES.find(l => l.code === language)?.flag || '🌐'}
              </button>
              {showLangMenu && (
                <div className="absolute right-0 top-full mt-1 bg-gray-900 border border-white/10 rounded-lg shadow-2xl z-50 w-40 py-1 max-h-60 overflow-y-auto">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setLanguage(lang.code);
                        chrome.storage.local.set({ aero_language: lang.code });
                        setShowLangMenu(false);
                        addLog(`Language: ${lang.label}`, 'success');
                        if (liveActive) { stopLive(); setTimeout(() => startLive(), 500); }
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] cursor-pointer flex items-center gap-2 transition-colors ${
                        language === lang.code
                          ? 'bg-purple-600/30 text-purple-300'
                          : 'text-white/60 hover:bg-white/10 hover:text-white/90'
                      }`}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { setHistory([]); setLogs([]); setTaskPlan(null); chrome.storage.local.remove('aero_state'); }} className="text-white/40 hover:text-red-400 transition-colors cursor-pointer text-[10px] px-1.5 py-0.5 rounded border border-white/10 hover:border-red-500/30" title="Reset">
              ✕
            </button>
            <button onClick={() => setShowLogs(l => !l)} className="text-white/40 hover:text-white/80 transition-colors cursor-pointer text-[10px] px-1.5 py-0.5 rounded border border-white/10 hover:border-white/30">
              {showLogs ? 'Chat' : 'Logs'}
            </button>

          </div>

          {/* Navigator Control */}
          <div className="px-3 pt-3">
            <button
              onClick={() => liveActive ? stopLive() : startLive()}
              className={`w-full py-3 rounded-xl text-[13px] font-semibold cursor-pointer transition-all border ${
                liveActive
                  ? liveConnected
                    ? 'bg-green-600/20 border-green-500/40 text-green-300 shadow-lg shadow-green-500/10'
                    : 'bg-yellow-600/20 border-yellow-500/40 text-yellow-300'
                  : 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-purple-500/30 text-white hover:from-blue-600/30 hover:to-purple-600/30'
              }`}
            >
              {liveActive
                ? liveConnected ? '🟢 Navigator Active — Click to stop' : '🟡 Connecting...'
                : '🎙️ Start Navigator'}
              <span className="block text-[9px] opacity-60 mt-0.5">
                {liveActive ? 'Autonomous · Vision + Actions · Multi-step' : 'Give a goal · AI plans & executes autonomously'}
              </span>
            </button>
          </div>

          {/* Status indicator */}
          <div className="px-3 pt-2 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              liveConnected ? 'bg-green-400 animate-pulse' : liveActive ? 'bg-yellow-400 animate-pulse' : 'bg-white/20'
            }`} />
            <span className="text-[11px] text-white/60 truncate">{speechStatus}</span>
            {currentAction && (
              <span className="text-[10px] text-purple-400 truncate ml-auto">⚡ {currentAction}</span>
            )}
          </div>

          {/* Task Plan Tracker */}
          {taskPlan && (
            <div className="mx-3 mt-2 rounded-xl border border-purple-500/20 bg-purple-900/10 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between border-b border-purple-500/10">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px]">{taskPlan.completed ? '✅' : '🎯'}</span>
                  <span className="text-[11px] font-semibold text-purple-300 truncate">{taskPlan.goal}</span>
                </div>
                {taskPlan.completed && (
                  <button onClick={() => setTaskPlan(null)} className="text-white/30 hover:text-white/60 text-[10px] cursor-pointer ml-1 flex-shrink-0">✕</button>
                )}
              </div>
              <div className="px-3 py-1.5 space-y-1">
                {taskPlan.steps.map((step, i) => {
                  const isDone = taskPlan.completed || i < taskPlan.currentStep;
                  const isActive = !taskPlan.completed && i === taskPlan.currentStep;
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5 text-[10px]">
                        {isDone ? '✓' : isActive ? '▸' : '○'}
                      </span>
                      <span className={`text-[10px] leading-snug ${
                        isDone ? 'text-emerald-400/70 line-through' :
                        isActive ? 'text-purple-300 font-medium' :
                        'text-white/30'
                      }`}>{step}</span>
                    </div>
                  );
                })}
              </div>
              {taskPlan.completed && taskPlan.summary && (
                <div className="px-3 py-2 border-t border-purple-500/10 text-[10px] text-emerald-400/80">
                  {taskPlan.summary}
                </div>
              )}
              {/* Progress bar */}
              {!taskPlan.completed && (
                <div className="h-0.5 bg-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, (taskPlan.currentStep / taskPlan.steps.length) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Quick-start task templates */}
          {!liveActive && !taskPlan && (
            <div className="px-3 pt-2 space-y-1.5">
              <p className="text-[10px] text-white/30 font-medium tracking-wider uppercase">Quick Tasks</p>
              {[
                { icon: '🔍', label: 'Search & summarize a topic', prompt: 'Search Google for the latest news about artificial intelligence, open the top 3 results one by one, read each article, then give me a brief summary of all three.' },
                { icon: '🛒', label: 'Compare products', prompt: 'Go to google.com, search for "best wireless headphones 2026", find the top 3 recommended products with their prices and give me a comparison.' },
                { icon: '📧', label: 'Fill a web form', prompt: 'Look at the current page and help me fill out any form you see. Ask me for each field value before typing.' },
                { icon: '📸', label: 'Describe this page', prompt: 'Analyze the current page screenshot in detail. Describe the layout, main content, navigation elements, and any interactive components you can see.' },
              ].map((tpl, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setManualPrompt(tpl.prompt);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-purple-600/15 border border-white/5 hover:border-purple-500/20 transition-all cursor-pointer group"
                >
                  <span className="text-[11px] text-white/70 group-hover:text-purple-300 flex items-center gap-2">
                    <span>{tpl.icon}</span>
                    <span>{tpl.label}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Manual input */}
          <div className="px-3 py-2 flex gap-2">
            <input
              type="text"
              value={manualPrompt}
              onChange={(e) => setManualPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSend()}
              placeholder={liveConnected ? 'Type a command...' : 'Type a goal or command...'}
              disabled={false}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
            />
            <button
              onClick={handleManualSend}
              disabled={!manualPrompt.trim()}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-30 text-white rounded-lg px-3 py-2 text-xs font-medium cursor-pointer transition-all disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>

          {/* Chat / Logs */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
            {!showLogs ? (
              <>
                {history.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-white/30 text-center px-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2 opacity-50"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <p className="text-[11px] mt-1">Start the navigator, then give it a goal</p>
                    <p className="text-[10px] text-white/20 mt-1">"Search for AI news and summarize the top 3 results"</p>
                  </div>
                )}
                {history.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600/80 text-white rounded-br-sm'
                        : msg.role === 'action'
                        ? 'bg-purple-600/20 text-purple-300 rounded-bl-sm border border-purple-500/20'
                        : 'bg-white/10 text-white/90 rounded-bl-sm'
                    }`}>
                      {msg.text}
                      {msg.streaming && <span className="inline-block w-1.5 h-3 bg-purple-400 ml-1 animate-pulse rounded-sm" />}
                    </div>
                  </div>
                ))}
                {currentAction && (
                  <div className="flex justify-start">
                    <div className="bg-purple-600/15 text-purple-300 px-3 py-2 rounded-2xl rounded-bl-sm text-xs flex items-center gap-2 border border-purple-500/20">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      ⚡ Executing...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </>
            ) : (
              <>  
                {/* Debug: last tagged screenshot sent to Gemini */}
                {lastTaggedScreenshot && (
                  <div className="mb-2">
                    <p className="text-[9px] text-white/30 font-mono mb-1 uppercase tracking-wider">Last screenshot sent to Gemini (with SoM tags)</p>
                    <img
                      src={lastTaggedScreenshot}
                      alt="Tagged screenshot"
                      className="w-full rounded border border-white/10"
                    />
                  </div>
                )}
                {logs.length === 0 && (
                  <div className="text-white/30 text-[11px] text-center py-8">No logs yet</div>
                )}
                {logs.map((log, i) => (
                  <div key={i} className={`text-[10px] leading-snug font-mono px-2 py-1 rounded ${
                    log.type === 'error' ? 'bg-red-500/10 text-red-400' :
                    log.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-white/5 text-white/60'
                  }`}>
                    <span className="text-white/30">[{log.time}]</span> {log.msg}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </>
            )}
          </div>

          {/* Status bar */}
          <div className="p-2 border-t border-white/10 text-[10px] text-white/40 flex items-center justify-between">
            <span className="truncate">{liveConnected ? '🟢 Navigator' : liveActive ? '🟡 Connecting' : '⚪ Off'}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => { setTtsEnabled(v => !v); }}
                className={`cursor-pointer px-1.5 py-0.5 rounded border transition-colors ${
                  ttsEnabled
                    ? 'border-white/10 text-white/50 hover:text-white/80'
                    : 'border-red-500/30 text-red-400'
                }`}
                title={ttsEnabled ? 'Mute responses' : 'Unmute responses'}
              >
                {ttsEnabled ? '🔊' : '🔇'}
              </button>
              <span className="text-white/30">Gemini 3.1 Flash-Lite</span>
            </div>
          </div>
        </div>
      </div>
      </>
    );
};

// Inject React root
const init = () => {
  const rootElement = document.createElement('div');
  rootElement.id = 'aero-browser-root';
  document.body.appendChild(rootElement);

  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
