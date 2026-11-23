"""Metabase dashboard and the steward's governance view, as screenshots."""
import os
from playwright.sync_api import sync_playwright
import ui_tour

CONTACTS = os.environ["KF_CONTACTS_ASSET"]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("KF_CHROME") or None)
    page = browser.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    page.goto("http://127.0.0.1:3031/auth/login")
    page.fill("input[name=username]", "ravi.iyer@kestrelfinch.example")
    page.fill("input[name=password]", "Kestrel-Demo-2026")
    page.keyboard.press("Enter")
    page.wait_for_timeout(4000)
    page.goto("http://127.0.0.1:3031/dashboard/2")
    page.wait_for_timeout(45000)
    ui_tour.shot(page, "08-metabase-dashboard")

    page = browser.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    ui_tour.sign_in(page, "henrike.sauer")
    for tab in ("governance", "data"):
        page.goto(f"{ui_tour.WEB}/{ui_tour.WS}/assets/{CONTACTS}?tab={tab}", timeout=180000, wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(15000)
        print(tab, page.inner_text("body")[:600].replace("\n", " | "))
        ui_tour.shot(page, f"09-steward-{tab}")
    browser.close()
