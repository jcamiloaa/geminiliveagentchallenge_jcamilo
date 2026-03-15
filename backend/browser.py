"""
Playwright browser controller for the AI Workforce Swarm.

Manages a headless Chromium instance and provides methods for:
- Navigation, clicking, typing (by SoM tag ID)
- Screenshots (streamed as base64 JPEG)
- Text extraction
- Page interaction (scroll, go_back, press_key)

The SoM tagging is done by som.py on each screenshot.
"""
import asyncio
import base64
import json
import random
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

# Viewport size — fits well as a panel in the web app
VIEWPORT = {"width": 1280, "height": 900}

# Stealth JS — hides common Playwright/automation fingerprints
_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'es'] });
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
});
window.chrome = { runtime: {} };
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
"""


class BrowserSession:
    """A single Playwright browser tab for the swarm to control."""

    def __init__(self):
        self._pw = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self.page: Page | None = None
        self._tag_map: list[dict] = []

    async def start(self):
        """Launch the headless browser."""
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
        self._context = await self._browser.new_context(
            viewport=VIEWPORT,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
            },
        )
        # Inject stealth script before any page loads
        await self._context.add_init_script(_STEALTH_JS)
        self.page = await self._context.new_page()

    async def stop(self):
        """Close browser and clean up."""
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    # ── Screenshot ──────────────────────────────────────────────────

    async def screenshot_b64(self) -> str:
        """Take a JPEG screenshot and return base64-encoded bytes."""
        buf = await self.page.screenshot(type="jpeg", quality=80, full_page=False)
        return base64.b64encode(buf).decode("ascii")

    # ── Navigation ──────────────────────────────────────────────────

    async def navigate_to(self, url: str) -> dict:
        try:
            await self.page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(random.uniform(0.5, 1.0))
            return {"success": True, "url": self.page.url}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def go_back(self) -> dict:
        await self.page.go_back(wait_until="domcontentloaded", timeout=10000)
        return {"success": True, "url": self.page.url}

    async def wait_for_page(self, timeout_ms: int = 5000) -> dict:
        try:
            await self.page.wait_for_load_state("networkidle", timeout=timeout_ms)
        except Exception:
            pass  # Best-effort
        return {"success": True, "url": self.page.url}

    # ── Tag-based interaction ───────────────────────────────────────

    def set_tag_map(self, tag_map: list[dict]):
        """Update the current tag map (set by SoM overlay)."""
        self._tag_map = tag_map

    def _find_tag(self, tag_id: int) -> dict | None:
        for entry in self._tag_map:
            if entry.get("id") == tag_id:
                return entry
        return None

    async def click_tag(self, tag_id: int, description: str = "") -> dict:
        """Click an element identified by its SoM tag ID."""
        tag = self._find_tag(tag_id)
        if not tag:
            return {"success": False, "error": f"Tag {tag_id} not found in tag_map"}

        # Human-like delay before clicking
        await asyncio.sleep(random.uniform(0.2, 0.6))

        selector = tag.get("selector")
        if selector:
            try:
                el = self.page.locator(selector).first
                await el.scroll_into_view_if_needed(timeout=3000)
                await el.click(timeout=5000)
                return {"success": True, "tag_id": tag_id, "description": description}
            except Exception as e:
                return {"success": False, "error": str(e), "tag_id": tag_id}

        # Fallback: click by coordinates from the tag map
        cx, cy = tag.get("cx", 0), tag.get("cy", 0)
        if cx and cy:
            await self.page.mouse.click(cx, cy)
            return {"success": True, "tag_id": tag_id, "via": "coordinates"}
        return {"success": False, "error": "No selector or coordinates for tag"}

    async def type_tag(self, tag_id: int, text: str) -> dict:
        """Focus an input by tag ID and type text."""
        tag = self._find_tag(tag_id)
        if not tag:
            return {"success": False, "error": f"Tag {tag_id} not found"}

        # Human-like delay before typing
        await asyncio.sleep(random.uniform(0.15, 0.4))

        selector = tag.get("selector")
        if selector:
            try:
                el = self.page.locator(selector).first
                await el.scroll_into_view_if_needed(timeout=3000)
                await el.click(timeout=3000)
                await el.fill(text)
                return {"success": True, "tag_id": tag_id}
            except Exception as e:
                return {"success": False, "error": str(e), "tag_id": tag_id}

        cx, cy = tag.get("cx", 0), tag.get("cy", 0)
        if cx and cy:
            await self.page.mouse.click(cx, cy)
            await self.page.keyboard.type(text, delay=30)
            return {"success": True, "tag_id": tag_id, "via": "coordinates"}
        return {"success": False, "error": "No selector or coordinates for tag"}

    async def press_key(self, key: str) -> dict:
        await self.page.keyboard.press(key)
        return {"success": True, "key": key}

    async def scroll_page(self, direction: str, amount: int = 400) -> dict:
        delta = amount if direction == "down" else -amount
        await self.page.mouse.wheel(0, delta)
        await asyncio.sleep(0.3)
        return {"success": True, "direction": direction, "amount": amount}

    # ── Text extraction ─────────────────────────────────────────────

    async def detect_blocked_page(self) -> str | None:
        """Check if the current page is an anti-bot or access-blocked page.
        Returns a short reason string if blocked, None otherwise."""
        try:
            text = (await self.page.locator("body").inner_text(timeout=3000)).lower()
        except Exception:
            return None

        blocked_patterns = [
            ("access is temporarily restricted", "access temporarily restricted"),
            ("unusual activity", "unusual activity detected"),
            ("captcha", "CAPTCHA challenge"),
            ("verify you are human", "human verification required"),
            ("please complete the security check", "security check required"),
            ("automated access", "automated access detected"),
            ("too many requests", "rate limited (429)"),
            ("access denied", "access denied"),
            ("blocked", "access blocked by website"),
            ("forbidden", "403 forbidden"),
            ("bot detection", "bot detection triggered"),
            ("please enable javascript", "JavaScript/cookie wall"),
            ("enable cookies", "JavaScript/cookie wall"),
        ]

        for pattern, reason in blocked_patterns:
            if pattern in text:
                return reason

        return None

    async def extract_text(self, selector: str = "", max_length: int = 3000) -> dict:
        """Extract visible text from the page or a CSS selector region."""
        try:
            if selector:
                el = self.page.locator(selector).first
                text = await el.inner_text(timeout=5000)
            else:
                text = await self.page.locator("body").inner_text(timeout=5000)
            text = text.strip()[:max_length]
            return {"success": True, "text": text, "length": len(text)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ── Tag generation (inject JS to find interactive elements) ─────

    async def generate_tag_map(self) -> list[dict]:
        """Find all interactive elements and produce a tag map with selectors + coordinates."""
        tag_map = await self.page.evaluate("""() => {
            const interactiveSelectors = [
                'a[href]', 'button', 'input', 'textarea', 'select',
                '[role="button"]', '[role="link"]', '[role="tab"]',
                '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
                '[onclick]', '[tabindex]', 'summary', 'details',
                'label[for]', '[contenteditable="true"]'
            ];
            const seen = new Set();
            const tags = [];
            let id = 1;

            for (const sel of interactiveSelectors) {
                for (const el of document.querySelectorAll(sel)) {
                    if (seen.has(el)) continue;
                    seen.add(el);

                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if (rect.top > window.innerHeight + 200) continue;
                    if (rect.bottom < -200) continue;

                    // Build a unique CSS selector
                    let selector = '';
                    if (el.id) {
                        selector = '#' + CSS.escape(el.id);
                    } else {
                        const tag = el.tagName.toLowerCase();
                        const parent = el.parentElement;
                        if (parent) {
                            const siblings = [...parent.children].filter(c => c.tagName === el.tagName);
                            const idx = siblings.indexOf(el) + 1;
                            const pSel = parent.id ? '#' + CSS.escape(parent.id) : parent.tagName.toLowerCase();
                            selector = `${pSel} > ${tag}:nth-of-type(${idx})`;
                        } else {
                            selector = tag;
                        }
                    }

                    // Label: text content or relevant attribute
                    let label = (el.textContent || '').trim().slice(0, 60);
                    if (!label) label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '';

                    tags.push({
                        id: id++,
                        tag: el.tagName.toLowerCase(),
                        label: label.slice(0, 60),
                        selector: selector,
                        cx: Math.round(rect.left + rect.width / 2),
                        cy: Math.round(rect.top + rect.height / 2),
                        w: Math.round(rect.width),
                        h: Math.round(rect.height),
                    });
                }
            }
            return tags;
        }""")
        self._tag_map = tag_map
        return tag_map
