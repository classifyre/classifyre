"""Which sidebar entries each persona is offered, and where sign-in lands."""
import os
from playwright.sync_api import sync_playwright
import ui_tour

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("KF_CHROME") or None)
    for user in ("jonas.eklund", "amelie.fontaine"):
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        ui_tour.sign_in(page, user)
        page.goto(f"{ui_tour.WEB}/{ui_tour.WS}")
        page.wait_for_timeout(4000)
        nav = page.locator("[data-sidebar='menu-button']").all_inner_texts()
        print(f"{user}: landed on {page.url.split(ui_tour.WS)[-1]}; sidebar: {[n.strip() for n in nav if n.strip()]}")
        ui_tour.shot(page, f"07-nav-{user.split('.')[0]}")
    browser.close()
