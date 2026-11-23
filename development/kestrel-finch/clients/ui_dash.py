import os, time
from playwright.sync_api import sync_playwright
import ui_tour
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("KF_CHROME") or None)
    page = b.new_context(viewport={"width": 1440, "height": 1000}).new_page()
    page.goto("http://127.0.0.1:3031/auth/login")
    page.fill("input[name=username]", "ravi.iyer@kestrelfinch.example")
    page.fill("input[name=password]", "Kestrel-Demo-2026")
    page.keyboard.press("Enter")
    page.wait_for_timeout(4000)
    t = time.monotonic()
    page.goto("http://127.0.0.1:3031/dashboard/2")
    for _ in range(60):
        page.wait_for_timeout(1000)
        body = page.inner_text("body")
        if "problem displaying" in body or ("DACH" in body and "Sparrow" in body and "Departures" in body):
            break
    print("dashboard settled in", round(time.monotonic() - t, 1), "s; errors:", page.inner_text("body").count("problem displaying"))
    ui_tour.shot(page, "08-metabase-dashboard")
    b.close()
